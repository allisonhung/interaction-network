"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase/client";
import type { ForceGraphMethods, LinkObject, NodeObject } from "react-force-graph-2d";

type GraphNode = {
  id: string;
  name: string;
  color: string;
};

type GraphLink = {
  id?: string;
  source: string;
  target: string;
  type: string;
  color: string;
};

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

type AgentMessage = {
  role: "user" | "assistant";
  text: string;
};

type SignupRequest = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
};

type NodeLayoutSnapshot = {
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
};

type ContextMenuTarget =
  | {
      kind: "node";
      node: {
        id: string;
        name: string;
      };
    }
  | {
      kind: "connection";
      link: {
        id?: string;
        source: string;
        target: string;
        type: string;
      };
    };

type ContextMenuState = {
  x: number;
  y: number;
  target: ContextMenuTarget;
} | null;

type InsertError = {
  message: string;
} | null;

const RELATION_TABLE_CANDIDATES = ["links", "connections", "edges"] as const;
const RELATIONSHIP_OPTIONS = ["friends", "exes", "lovers", "enemies", "family"] as const;
type RelationshipType = (typeof RELATIONSHIP_OPTIONS)[number];
const RELATIONSHIP_COLORS: Record<RelationshipType, string> = {
  friends: "#22c55e",
  exes: "#000000",
  lovers: "#ec4899",
  enemies: "#ef4444",
  family: "#8b5cf6",
};

const hasMissingColumnError = (message: string | undefined, column: string) => {
  return (message ?? "").includes(`Could not find the '${column}' column`);
};

const hasMissingTableError = (message: string | undefined, table: string) => {
  return (message ?? "").includes(`Could not find the table 'public.${table}'`);
};

// Next.js requires graph libraries to be loaded dynamically on the client side
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

const EXAMPLE_PROMPTS = [
  "Who are the most connected people in this network?",
  "Identify any love triangles or complex relationship webs.",
  "Map out distinct friend groups and clusters.",
  "Who bridges different groups or communities?",
  "Find relationships that have conflicting dynamics (e.g., friend with an enemy).",
  "Suggest an event guest list that would minimize relationship tension.",
];

export default function NetworkGraph() {
  const graphRef = useRef<
    ForceGraphMethods<NodeObject, LinkObject> | undefined
  >(undefined);
  const graphAreaRef = useRef<HTMLDivElement | null>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [includeFriendships, setIncludeFriendships] = useState(true);
  const [includeExes, setIncludeExes] = useState(true);
  const [includeEnemies, setIncludeEnemies] = useState(true);
  const [includeLovers, setIncludeLovers] = useState(true);
  const [includeFamily, setIncludeFamily] = useState(true);
  const [isDispersed, setIsDispersed] = useState(false);
  const [layoutSnapshot, setLayoutSnapshot] = useState<Record<string, NodeLayoutSnapshot> | null>(
    null
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [relationTable, setRelationTable] = useState<string | null>(null);
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [showAccountRequestForm, setShowAccountRequestForm] = useState(false);
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [requestFirstName, setRequestFirstName] = useState("");
  const [requestLastName, setRequestLastName] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [pendingRequests, setPendingRequests] = useState<SignupRequest[]>([]);
  const [isLoadingPendingRequests, setIsLoadingPendingRequests] = useState(false);
  const [isApprovingRequestId, setIsApprovingRequestId] = useState<string | null>(null);
  const [isDenyingRequestId, setIsDenyingRequestId] = useState<string | null>(null);
  const [isApprovalsMinimized, setIsApprovalsMinimized] = useState(false);
  const [personAQuery, setPersonAQuery] = useState("");
  const [personBQuery, setPersonBQuery] = useState("");
  const [connectionType, setConnectionType] = useState<RelationshipType>("friends");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentQuestion, setAgentQuestion] = useState("");
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    {
      role: "assistant",
      text:
        "Ask about group dynamics. Example: Who should I invite to maximize friends with no enemies present?",
    },
  ]);

  const getCurrentUserId = useCallback(async () => {
    const { data, error: userError } = await supabase.auth.getUser();

    if (userError) {
      setError(userError.message);
      return null;
    }

    if (!data.user) {
      return null;
    }

    return data.user.id;
  }, []);

  const normalizeNodes = (data: Record<string, unknown>[]) => {
    return data.map((node) => ({
      id: String(node.id),
      name: String(node.name),
      color: typeof node.color === "string" && node.color ? node.color : "#3b82f6",
    }));
  };

  const normalizeLinks = (data: Record<string, unknown>[]) => {
    return data.map((link) => {
      const linkType =
        (typeof link.type === "string" && link.type) ||
        (typeof link.relationship_type === "string" && link.relationship_type)
          ? String(link.type ?? link.relationship_type)
          : "Friend";
      const normalizedType = linkType.toLowerCase() as RelationshipType;
      const defaultColor =
        normalizedType in RELATIONSHIP_COLORS
          ? RELATIONSHIP_COLORS[normalizedType]
          : RELATIONSHIP_COLORS.friends;
      return {
        id: typeof link.id === "string" ? link.id : undefined,
        source: String(link.source),
        target: String(link.target),
        type: linkType,
        color:
          typeof link.color === "string" && link.color
            ? link.color
            : defaultColor,
      };
    });
  };

  const isRelationshipVisible = (type: string) => {
    const normalizedType = type.toLowerCase();
    switch (normalizedType) {
      case "friends":
        return includeFriendships;
      case "enemies":
        return includeEnemies;
      case "lovers":
        return includeLovers;
      case "family":
        return includeFamily;
      case "exes":
        return includeExes;
      default:
        return true;
    }
  };

  const getVisibleGraphData = () => {
    return {
      nodes: graphData.nodes,
      links: graphData.links.filter((link) => isRelationshipVisible(String(link.type))),
    };
  };

  const fetchLinksFromAvailableTable = useCallback(async () => {
    for (const table of RELATION_TABLE_CANDIDATES) {
      const scopedResult = await supabase.from(table).select("*");

      if (scopedResult.error) {
        if (hasMissingTableError(scopedResult.error.message, table)) {
          continue;
        }

        return { table: null, data: [], error: scopedResult.error };
      }

      return { table, data: scopedResult.data ?? [], error: null };
    }

    return { table: null, data: [], error: null };
  }, []);

  const fetchGraphData = useCallback(async () => {
    setIsLoading(true);

    const effectiveNodesResult = await supabase.from("nodes").select("*");
    const linksLookup = await fetchLinksFromAvailableTable();

    if (effectiveNodesResult.error || linksLookup.error) {
      setError(
        effectiveNodesResult.error?.message ??
          linksLookup.error?.message ??
          "Unable to load graph data from Supabase."
      );
      setGraphData({ nodes: [], links: [] });
      setIsLoading(false);
      return;
    }

    const nodes = normalizeNodes((effectiveNodesResult.data ?? []) as Record<string, unknown>[]);
    const links = normalizeLinks((linksLookup.data ?? []) as Record<string, unknown>[]);

    setError(null);
    setRelationTable(linksLookup.table);
    setGraphData({ nodes, links });

    setIsLoading(false);
  }, [fetchLinksFromAvailableTable]);

  const handleAddPerson = async () => {
    if (!currentUserId) {
      setError("You must be signed in before adding a person.");
      return;
    }

    const name = window.prompt("Enter the person's name:")?.trim();
    if (!name) {
      return;
    }

    const color = window.prompt("Enter a node color (hex), or leave blank:", "#3b82f6")?.trim();

    setIsSaving(true);
    setError(null);

    let { error: insertError } = await supabase.from("nodes").insert({
      name,
      color: color || "#3b82f6",
      user_id: currentUserId,
    });

    if (insertError && hasMissingColumnError(insertError.message, "color")) {
      const retryResult = await supabase.from("nodes").insert({
        name,
        user_id: currentUserId,
      });
      insertError = retryResult.error;
    }

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    await fetchGraphData();
    setIsSaving(false);
  };

  const handleSignIn = async () => {
    const email = signInEmail.trim();
    const password = signInPassword;

    if (!email || !password) {
      setError("Enter your email and password.");
      setAuthMessage(null);
      return;
    }

    setIsSigningIn(true);
    setError(null);
    setAuthMessage(null);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setAuthMessage(null);
      setIsSigningIn(false);
      return;
    }

    const userId = data.user?.id ?? null;
    setCurrentUserId(userId);
    setSignInEmail("");
    setSignInPassword("");
    setAuthMessage(null);
    await fetchGraphData();
    await loadPendingRequests();
    setIsSigningIn(false);
  };

  const loadPendingRequests = useCallback(async () => {
    if (!currentUserId) {
      setPendingRequests([]);
      return;
    }

    setIsLoadingPendingRequests(true);

    const requestResult = await supabase
      .from("signup_requests")
      .select("*")
      .order("id", { ascending: true });

    if (requestResult.error) {
      if (hasMissingTableError(requestResult.error.message, "signup_requests")) {
        setPendingRequests([]);
        setIsLoadingPendingRequests(false);
        return;
      }

      setError(requestResult.error.message);
      setPendingRequests([]);
      setIsLoadingPendingRequests(false);
      return;
    }

    const normalized = ((requestResult.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => ({
        id: String(row.id ?? ""),
        email: String(row.email ?? ""),
        firstName: String(row.first_name ?? ""),
        lastName: String(row.last_name ?? ""),
        status: String(row.status ?? "pending").toLowerCase(),
      }))
      .filter((row) => row.id && row.email)
      .filter((row) => row.status === "pending");

    setPendingRequests(normalized);
    setIsLoadingPendingRequests(false);
  }, [currentUserId]);

  const handleApproveRequest = async (requestId: string, email: string) => {
    if (!currentUserId) {
      setError("You must be signed in before approving requests.");
      return;
    }

    setIsApprovingRequestId(requestId);
    setError(null);
    setAuthMessage(null);

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      setError(sessionError?.message ?? "No active session token found.");
      setIsApprovingRequestId(null);
      return;
    }

    const response = await fetch("/api/admin/approve-signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ requestId, email }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(errorBody?.error ?? "Unable to approve this request.");
      setIsApprovingRequestId(null);
      return;
    }

    const result = (await response.json()) as { message?: string };
    setAuthMessage(result.message ?? `Invite email sent to ${email}.`);
    await loadPendingRequests();
    setIsApprovingRequestId(null);
  };

  const handleDenyRequest = async (requestId: string) => {
    if (!currentUserId) {
      setError("You must be signed in before denying requests.");
      return;
    }

    setIsDenyingRequestId(requestId);
    setError(null);
    setAuthMessage(null);

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      setError(sessionError?.message ?? "No active session token found.");
      setIsDenyingRequestId(null);
      return;
    }

    const response = await fetch("/api/admin/deny-signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ requestId }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(errorBody?.error ?? "Unable to deny this request.");
      setIsDenyingRequestId(null);
      return;
    }

    setAuthMessage("Request denied.");
    await loadPendingRequests();
    setIsDenyingRequestId(null);
  };

  const handleCreateAccountRequest = async () => {
    const firstName = requestFirstName.trim();
    const lastName = requestLastName.trim();
    const email = requestEmail.trim();

    if (!firstName || !lastName || !email) {
      setError("Enter first name, last name, and email.");
      setAuthMessage(null);
      return;
    }

    setIsSigningIn(true);
    setError(null);
    setAuthMessage(null);

    let { error: requestError } = await supabase.from("signup_requests").insert({
      first_name: firstName,
      last_name: lastName,
      email,
      status: "pending",
    });

    if (requestError && hasMissingColumnError(requestError.message, "status")) {
      const retryResult = await supabase.from("signup_requests").insert({
        first_name: firstName,
        last_name: lastName,
        email,
      });
      requestError = retryResult.error;
    }

    if (
      requestError &&
      (hasMissingColumnError(requestError.message, "first_name") ||
        hasMissingColumnError(requestError.message, "last_name"))
    ) {
      const retryResult = await supabase.from("signup_requests").insert({
        email,
        status: "pending",
      });
      requestError = retryResult.error;

      if (requestError && hasMissingColumnError(requestError.message, "status")) {
        const finalRetryResult = await supabase.from("signup_requests").insert({ email });
        requestError = finalRetryResult.error;
      }
    }

    if (requestError && hasMissingTableError(requestError.message, "signup_requests")) {
      setError(
        "Missing signup_requests table. Create it in Supabase to use approval-based access requests."
      );
      setAuthMessage(null);
      setIsSigningIn(false);
      return;
    }

    if (requestError) {
      setError(requestError.message);
      setAuthMessage(null);
      setIsSigningIn(false);
      return;
    }

    setRequestFirstName("");
    setRequestLastName("");
    setRequestEmail("");
    setShowAccountRequestForm(false);
    setAuthMessage("Access request submitted. An admin must approve your account.");

    setIsSigningIn(false);
  };

  const handleSignOut = async () => {
    setIsSigningIn(true);
    setError(null);
    setAuthMessage(null);

    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(signOutError.message);
      setIsSigningIn(false);
      return;
    }

    setCurrentUserId(null);
    setGraphData({ nodes: [], links: [] });
    setShowConnectionForm(false);
    setShowAccountRequestForm(false);
    setSignInEmail("");
    setSignInPassword("");
    setRequestFirstName("");
    setRequestLastName("");
    setRequestEmail("");
    setPendingRequests([]);
    setPersonAQuery("");
    setPersonBQuery("");
    setConnectionType("friends");
    setIsApprovalsMinimized(false);
    setIsSigningIn(false);
  };

  const findNodeByName = (query: string) => {
    return graphData.nodes.find((node) => node.name.toLowerCase() === query.trim().toLowerCase());
  };

  const getEndpointId = (endpoint: unknown) => {
    if (typeof endpoint === "string" || typeof endpoint === "number") {
      return String(endpoint);
    }

    if (endpoint && typeof endpoint === "object" && "id" in endpoint) {
      const endpointId = (endpoint as { id?: unknown }).id;
      if (typeof endpointId === "string" || typeof endpointId === "number") {
        return String(endpointId);
      }
    }

    return null;
  };

  const openContextMenu = (target: ContextMenuTarget, event: MouseEvent) => {
    event.preventDefault();

    if (!currentUserId) {
      setError("You must be signed in to edit or delete nodes and connections.");
      return;
    }

    const rect = graphAreaRef.current?.getBoundingClientRect();
    const relativeX = rect ? event.clientX - rect.left : event.clientX;
    const relativeY = rect ? event.clientY - rect.top : event.clientY;

    setContextMenu({
      x: Math.max(8, relativeX),
      y: Math.max(8, relativeY),
      target,
    });
  };

  const deleteNode = async (node: { id: string; name: string }) => {
    const confirmed = window.confirm(`Delete ${node.name} and their connections?`);
    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    setError(null);

    const deleteResult = await supabase.from("nodes").delete().eq("id", node.id);

    if (deleteResult.error) {
      setError(deleteResult.error.message);
      setIsSaving(false);
      return;
    }

    await fetchGraphData();
    setIsSaving(false);
  };

  const deleteConnection = async (link: { id?: string; source: string; target: string; type: string }) => {
    const confirmed = window.confirm("Delete this connection?");
    if (!confirmed) {
      return;
    }

    setIsSaving(true);
    setError(null);

    const tableCandidates = relationTable
      ? [relationTable, ...RELATION_TABLE_CANDIDATES.filter((table) => table !== relationTable)]
      : [...RELATION_TABLE_CANDIDATES];

    const [firstNodeId, secondNodeId] = [link.source, link.target].sort();
    const linkType = link.type;
    let deleted = false;
    let lastErrorMessage: string | null = null;

    for (const table of tableCandidates) {
      let deleteResult;

      if (link.id) {
        deleteResult = await supabase.from(table).delete().eq("id", link.id);
      } else {
        deleteResult = await supabase
          .from(table)
          .delete()
          .eq("source", firstNodeId)
          .eq("target", secondNodeId);

        if (table === "edges" && linkType) {
          const typedResult = await supabase
            .from(table)
            .delete()
            .eq("source", firstNodeId)
            .eq("target", secondNodeId)
            .eq("relationship_type", linkType);
          if (!typedResult.error) {
            deleteResult = typedResult;
          }
        }
      }

      if (deleteResult.error) {
        if (hasMissingTableError(deleteResult.error.message, table)) {
          continue;
        }
        lastErrorMessage = deleteResult.error.message;
        continue;
      }

      deleted = true;
      setRelationTable(table);
      break;
    }

    if (!deleted) {
      setError(lastErrorMessage ?? "Unable to delete the selected connection.");
      setIsSaving(false);
      return;
    }

    await fetchGraphData();
    setIsSaving(false);
  };

  const editNodeName = async (node: { id: string; name: string }) => {
    const nextName = window.prompt("Enter new node name:", node.name)?.trim();
    if (!nextName || nextName === node.name) {
      return;
    }

    setIsSaving(true);
    setError(null);

    const updateResult = await supabase.from("nodes").update({ name: nextName }).eq("id", node.id);

    if (updateResult.error) {
      setError(updateResult.error.message);
      setIsSaving(false);
      return;
    }

    await fetchGraphData();
    setIsSaving(false);
  };

  const editConnectionType = async (link: { id?: string; source: string; target: string; type: string }) => {
    const currentType = link.type.toLowerCase();
    const nextTypeInput = window
      .prompt(`Enter relationship type (${RELATIONSHIP_OPTIONS.join(", ")}):`, currentType)
      ?.trim()
      .toLowerCase();

    if (!nextTypeInput || nextTypeInput === currentType) {
      return;
    }

    if (!RELATIONSHIP_OPTIONS.includes(nextTypeInput as RelationshipType)) {
      setError(`Invalid type. Use one of: ${RELATIONSHIP_OPTIONS.join(", ")}.`);
      return;
    }

    const nextType = nextTypeInput as RelationshipType;
    const nextColor = RELATIONSHIP_COLORS[nextType];

    setIsSaving(true);
    setError(null);

    const tableCandidates = relationTable
      ? [relationTable, ...RELATION_TABLE_CANDIDATES.filter((table) => table !== relationTable)]
      : [...RELATION_TABLE_CANDIDATES];

    const [firstNodeId, secondNodeId] = [link.source, link.target].sort();
    let updated = false;
    let lastErrorMessage: string | null = null;

    for (const table of tableCandidates) {
      const payloadAttempts =
        table === "edges"
          ? [
              { relationship_type: nextType, color: nextColor },
              { relationship_type: nextType },
              { type: nextType, color: nextColor },
              { type: nextType },
            ]
          : [
              { type: nextType, color: nextColor },
              { type: nextType },
              { relationship_type: nextType, color: nextColor },
              { relationship_type: nextType },
            ];

      for (const payload of payloadAttempts) {
        let updateQuery = supabase.from(table).update(payload);

        if (link.id) {
          updateQuery = updateQuery.eq("id", link.id);
        } else {
          updateQuery = updateQuery.eq("source", firstNodeId).eq("target", secondNodeId);
        }

        const updateResult = await updateQuery;

        if (updateResult.error) {
          if (hasMissingTableError(updateResult.error.message, table)) {
            break;
          }
          if (
            hasMissingColumnError(updateResult.error.message, "type") ||
            hasMissingColumnError(updateResult.error.message, "relationship_type") ||
            hasMissingColumnError(updateResult.error.message, "color")
          ) {
            lastErrorMessage = updateResult.error.message;
            continue;
          }

          lastErrorMessage = updateResult.error.message;
          break;
        }

        updated = true;
        setRelationTable(table);
        break;
      }

      if (updated) {
        break;
      }
    }

    if (!updated) {
      setError(lastErrorMessage ?? "Unable to edit the selected connection.");
      setIsSaving(false);
      return;
    }

    await fetchGraphData();
    setIsSaving(false);
  };

  const handleContextMenuDelete = async () => {
    if (!contextMenu) {
      return;
    }

    const target = contextMenu.target;
    setContextMenu(null);

    if (target.kind === "node") {
      await deleteNode(target.node);
      return;
    }

    await deleteConnection(target.link);
  };

  const handleContextMenuEdit = async () => {
    if (!contextMenu) {
      return;
    }

    const target = contextMenu.target;
    setContextMenu(null);

    if (target.kind === "node") {
      await editNodeName(target.node);
      return;
    }

    await editConnectionType(target.link);
  };

  const handleAddConnection = async () => {
    if (!currentUserId) {
      setError("You must be signed in before adding a connection.");
      return;
    }

    if (graphData.nodes.length < 2) {
      setError("Add at least two people before creating a connection.");
      return;
    }

    const sourceNode = findNodeByName(personAQuery);
    const targetNode = findNodeByName(personBQuery);

    if (!sourceNode || !targetNode) {
      setError("Both people must be selected from existing nodes.");
      return;
    }

    if (sourceNode.id === targetNode.id) {
      setError("Choose two different people for a connection.");
      return;
    }

    const type = RELATIONSHIP_OPTIONS.includes(connectionType) ? connectionType : "friends";
    const color = RELATIONSHIP_COLORS[type];

    setIsSaving(true);
    setError(null);

    const tableCandidates = relationTable
      ? [relationTable, ...RELATION_TABLE_CANDIDATES.filter((table) => table !== relationTable)]
      : [...RELATION_TABLE_CANDIDATES];

    let selectedTable: string | null = null;
    let insertError: InsertError = null;

    for (const table of tableCandidates) {
      selectedTable = table;

      const [firstNodeId, secondNodeId] = [sourceNode.id, targetNode.id].sort();

      const basePayload = {
        source: firstNodeId,
        target: secondNodeId,
        user_id: currentUserId,
      };

      const typedPayload =
        table === "edges"
          ? { ...basePayload, relationship_type: type, color }
          : { ...basePayload, type, color };

      const insertResult = await supabase.from(table).insert(typedPayload);

      insertError = insertResult.error ? { message: insertResult.error.message } : null;

      if (
        insertError &&
        (hasMissingColumnError(insertError.message, "type") ||
          hasMissingColumnError(insertError.message, "relationship_type") ||
          hasMissingColumnError(insertError.message, "color"))
      ) {
        const minimalPayload =
          table === "edges"
            ? { ...basePayload, relationship_type: type }
            : { ...basePayload, type };

        const retryResult = await supabase.from(table).insert(minimalPayload);

        insertError = retryResult.error ? { message: retryResult.error.message } : null;
      }

      if (insertError && hasMissingTableError(insertError.message, table)) {
        continue;
      }

      break;
    }

    if (insertError && hasMissingTableError(insertError.message, selectedTable ?? "links")) {
      insertError = {
        message: "Could not find a relationship table. Create one named links, connections, or edges.",
      };
    }

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    setRelationTable(selectedTable);
    setPersonAQuery("");
    setPersonBQuery("");
    setConnectionType("friends");
    setShowConnectionForm(false);

    await fetchGraphData();
    setIsSaving(false);
  };

  const getGraphInsightsAnswer = (question: string) => {
    const q = question.trim().toLowerCase();
    if (!q) {
      return "Please type a question first.";
    }

    const nodeNames = graphData.nodes.map((node) => node.name);
    if (nodeNames.length === 0) {
      return "There are no people in the graph yet.";
    }

    const idToName = new Map(graphData.nodes.map((node) => [node.id, node.name]));

    const activeLinks = graphData.links.filter((link) => isRelationshipVisible(String(link.type)));

    const normalizedLinks = activeLinks
      .map((link) => {
        const source = String(link.source);
        const target = String(link.target);
        const type = String(link.type ?? "friends").toLowerCase();
        return { source, target, type };
      })
      .filter((link) => idToName.has(link.source) && idToName.has(link.target));

    const enemyPairs = new Set<string>();
    const friendPairs = new Set<string>();

    for (const link of normalizedLinks) {
      const a = link.source < link.target ? link.source : link.target;
      const b = link.source < link.target ? link.target : link.source;
      const key = `${a}|${b}`;

      if (link.type === "enemies") {
        enemyPairs.add(key);
      }
      if (link.type === "friends") {
        friendPairs.add(key);
      }
    }

    const ids = graphData.nodes.map((node) => node.id);

    const scoreSubset = (subsetIds: string[]) => {
      let friendCount = 0;
      for (let i = 0; i < subsetIds.length; i += 1) {
        for (let j = i + 1; j < subsetIds.length; j += 1) {
          const a = subsetIds[i] < subsetIds[j] ? subsetIds[i] : subsetIds[j];
          const b = subsetIds[i] < subsetIds[j] ? subsetIds[j] : subsetIds[i];
          const key = `${a}|${b}`;
          if (enemyPairs.has(key)) {
            return { valid: false, friendCount: 0 };
          }
          if (friendPairs.has(key)) {
            friendCount += 1;
          }
        }
      }
      return { valid: true, friendCount };
    };

    const findBestParty = () => {
      const n = ids.length;
      const bruteForceLimit = 18;

      if (n <= bruteForceLimit) {
        let best: { ids: string[]; friends: number } = { ids: [], friends: 0 };
        const totalMasks = 1 << n;

        for (let mask = 1; mask < totalMasks; mask += 1) {
          const subsetIds: string[] = [];
          for (let i = 0; i < n; i += 1) {
            if ((mask & (1 << i)) !== 0) {
              subsetIds.push(ids[i]);
            }
          }

          const score = scoreSubset(subsetIds);
          if (!score.valid) {
            continue;
          }

          if (
            subsetIds.length > best.ids.length ||
            (subsetIds.length === best.ids.length && score.friendCount > best.friends)
          ) {
            best = { ids: subsetIds, friends: score.friendCount };
          }
        }

        return best;
      }

      const shuffledIds = [...ids].sort((a, b) => {
        const aConflicts = normalizedLinks.filter(
          (link) => link.type === "enemies" && (link.source === a || link.target === a)
        ).length;
        const bConflicts = normalizedLinks.filter(
          (link) => link.type === "enemies" && (link.source === b || link.target === b)
        ).length;
        return aConflicts - bConflicts;
      });

      const picked: string[] = [];
      for (const candidate of shuffledIds) {
        const next = [...picked, candidate];
        const score = scoreSubset(next);
        if (score.valid) {
          picked.push(candidate);
        }
      }

      const score = scoreSubset(picked);
      return { ids: picked, friends: score.friendCount };
    };

    if ((q.includes("party") || q.includes("invite")) && q.includes("friend")) {
      const best = findBestParty();
      const invitees = best.ids.map((id) => idToName.get(id) ?? id);
      if (invitees.length === 0) {
        return "I could not find a valid invite list with the current graph.";
      }
      return `Invite: ${invitees.join(", " )}. This gives ${invitees.length} people with ${best.friends} friend connection(s) and no enemies present together.`;
    }

    if (q.includes("most connected") || q.includes("central") || q.includes("hub")) {
      const degree = new Map<string, number>();
      for (const id of ids) {
        degree.set(id, 0);
      }
      for (const link of normalizedLinks) {
        degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
        degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
      }
      const top = [...degree.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!top) {
        return "No connections yet, so no one is central yet.";
      }
      return `${idToName.get(top[0])} is currently most connected with ${top[1]} connection(s).`;
    }

    if (q.includes("enemy") || q.includes("conflict")) {
      const conflicts = [...enemyPairs].map((pair) => {
        const [a, b] = pair.split("|");
        return `${idToName.get(a)} ↔ ${idToName.get(b)}`;
      });
      if (conflicts.length === 0) {
        return "No enemy conflicts are present in the graph.";
      }
      return `Current conflicts: ${conflicts.join("; ")}.`;
    }

    return "I can currently answer: party invite optimization (maximize friends with no enemies), most connected person, and current conflicts. Try one of those phrasings.";
  };

  const handleAskAgent = async () => {
    const question = agentQuestion.trim();
    if (!question) {
      return;
    }

    setIsAgentLoading(true);
    setAgentError(null);
    setAgentMessages((current) => [
      ...current,
      { role: "user", text: question },
    ]);
    setAgentQuestion("");

    try {
      const response = await fetch("/api/social-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, graphData }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Server agent unavailable");
      }

      const data = (await response.json()) as { answer?: string };
      const answer = data.answer?.trim();
      if (!answer) {
        throw new Error("Empty answer");
      }

      setAgentMessages((current) => [...current, { role: "assistant", text: answer }]);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Backend agent failed. Check that the dev server was restarted after editing .env.local and that GEMINI_API_KEY is valid.";
      setAgentError(errorMessage);
      const fallback = getGraphInsightsAnswer(question);
      setAgentMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: `${fallback}\n\n(Using local fallback analyzer. Configure GEMINI_API_KEY to enable full LLM responses.)`,
        },
      ]);
    } finally {
      setIsAgentLoading(false);
    }
  };

  const handleDisperseClusters = () => {
    if (isDispersed && layoutSnapshot) {
      const nodesById = new Map(graphData.nodes.map((node) => [node.id, node]));

      for (const [id, snapshot] of Object.entries(layoutSnapshot)) {
        const node = nodesById.get(id) as
          | (GraphNode & { x?: number; y?: number; fx?: number; fy?: number })
          | undefined;
        if (!node) {
          continue;
        }

        node.x = snapshot.x;
        node.y = snapshot.y;
        node.fx = snapshot.fx;
        node.fy = snapshot.fy;
      }

      setGraphData((current) => ({
        nodes: [...current.nodes],
        links: [...current.links],
      }));

      setIsDispersed(false);
      setLayoutSnapshot(null);
      graphRef.current?.d3ReheatSimulation?.();

      // Zoom to fit all nodes after restoring layout
      setTimeout(() => {
        graphRef.current?.zoomToFit?.();
      }, 100);
      return;
    }

    const snapshot: Record<string, NodeLayoutSnapshot> = {};
    for (const node of graphData.nodes as Array<
      GraphNode & { x?: number; y?: number; fx?: number; fy?: number }
    >) {
      snapshot[node.id] = {
        x: node.x,
        y: node.y,
        fx: node.fx,
        fy: node.fy,
      };
    }

    const visible = getVisibleGraphData();
    const nodeIds = visible.nodes.map((node) => node.id);

    if (nodeIds.length === 0) {
      return;
    }

    const adjacency = new Map<string, Set<string>>();
    for (const id of nodeIds) {
      adjacency.set(id, new Set());
    }

    for (const link of visible.links) {
      const source = String(link.source);
      const target = String(link.target);
      if (!adjacency.has(source) || !adjacency.has(target)) {
        continue;
      }
      adjacency.get(source)?.add(target);
      adjacency.get(target)?.add(source);
    }

    const visited = new Set<string>();
    const components: string[][] = [];

    for (const id of nodeIds) {
      if (visited.has(id)) {
        continue;
      }

      const stack = [id];
      const component: string[] = [];
      visited.add(id);

      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
          continue;
        }
        component.push(current);

        for (const neighbor of adjacency.get(current) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            stack.push(neighbor);
          }
        }
      }

      components.push(component);
    }

    components.sort((a, b) => b.length - a.length);

    const nodesById = new Map(graphData.nodes.map((node) => [node.id, node]));

    const componentCount = components.length;
    const clusterSeparation = 320;
    const centerRingRadius =
      componentCount <= 1
        ? 0
        : Math.max(140, (componentCount * clusterSeparation) / (2 * Math.PI));

    const uniqueEdgePairs = (componentSet: Set<string>) => {
      const seen = new Set<string>();
      const pairs: Array<[string, string]> = [];

      for (const link of visible.links) {
        const source = String(link.source);
        const target = String(link.target);
        if (!componentSet.has(source) || !componentSet.has(target) || source === target) {
          continue;
        }

        const a = source < target ? source : target;
        const b = source < target ? target : source;
        const key = `${a}|${b}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        pairs.push([a, b]);
      }

      return pairs;
    };

    const countCrossings = (order: string[], edges: Array<[string, string]>) => {
      const indexById = new Map(order.map((id, idx) => [id, idx]));

      const crosses = (a: number, b: number, c: number, d: number) => {
        const ab0 = Math.min(a, b);
        const ab1 = Math.max(a, b);
        const cd0 = Math.min(c, d);
        const cd1 = Math.max(c, d);
        return (ab0 < cd0 && cd0 < ab1 && ab1 < cd1) || (cd0 < ab0 && ab0 < cd1 && cd1 < ab1);
      };

      let count = 0;
      for (let i = 0; i < edges.length; i += 1) {
        for (let j = i + 1; j < edges.length; j += 1) {
          const [a, b] = edges[i];
          const [c, d] = edges[j];
          if (a === c || a === d || b === c || b === d) {
            continue;
          }

          const ia = indexById.get(a);
          const ib = indexById.get(b);
          const ic = indexById.get(c);
          const id = indexById.get(d);

          if (ia === undefined || ib === undefined || ic === undefined || id === undefined) {
            continue;
          }

          if (crosses(ia, ib, ic, id)) {
            count += 1;
          }
        }
      }

      return count;
    };

    components.forEach((component, index) => {
      const centerAngle = componentCount <= 1 ? 0 : (2 * Math.PI * index) / componentCount;
      const cx = centerRingRadius * Math.cos(centerAngle);
      const cy = centerRingRadius * Math.sin(centerAngle);

      if (component.length === 1) {
        const single = nodesById.get(component[0]) as
          | (GraphNode & { fx?: number; fy?: number })
          | undefined;
        if (single) {
          single.fx = cx;
          single.fy = cy;
        }
        return;
      }

      const componentSet = new Set(component);
      const degreeInComponent = (id: string) =>
        [...(adjacency.get(id) ?? [])].filter((neighbor) => componentSet.has(neighbor)).length;

      const edges = uniqueEdgePairs(componentSet);

      const singletonNodes = component
        .filter((id) => degreeInComponent(id) <= 1)
        .sort((a, b) => degreeInComponent(a) - degreeInComponent(b));
      const coreNodes = component
        .filter((id) => degreeInComponent(id) > 1)
        .sort((a, b) => degreeInComponent(b) - degreeInComponent(a));

      let order = [...coreNodes, ...singletonNodes];
      if (order.length === 0) {
        order = [...component];
      }

      let bestOrder = [...order];
      let bestCross = countCrossings(bestOrder, edges);

      for (let pass = 0; pass < 24; pass += 1) {
        let improved = false;

        for (let i = 0; i < bestOrder.length - 1; i += 1) {
          const swapped = [...bestOrder];
          const tmp = swapped[i];
          swapped[i] = swapped[i + 1];
          swapped[i + 1] = tmp;

          const swappedSingletonCount = swapped.filter((id) => degreeInComponent(id) <= 1).length;
          const singletonBlock = swapped.slice(swapped.length - swappedSingletonCount);
          const singletonBlockValid = singletonBlock.every((id) => degreeInComponent(id) <= 1);
          if (!singletonBlockValid) {
            continue;
          }

          const cross = countCrossings(swapped, edges);
          if (cross < bestCross) {
            bestCross = cross;
            bestOrder = swapped;
            improved = true;
          }
        }

        if (!improved) {
          break;
        }
      }

      const baseRotation = componentCount <= 1 ? -Math.PI / 2 : centerAngle;
      const radius = Math.max(95, bestOrder.length * 17);

      bestOrder.forEach((id, nodeIndex) => {
        const node = nodesById.get(id) as
          | (GraphNode & { fx?: number; fy?: number })
          | undefined;
        if (!node) {
          return;
        }

        const angle = baseRotation + (2 * Math.PI * nodeIndex) / bestOrder.length;
        node.fx = cx + radius * Math.cos(angle);
        node.fy = cy + radius * Math.sin(angle);
      });
    });

    setGraphData((current) => ({
      nodes: [...current.nodes],
      links: [...current.links],
    }));

    setLayoutSnapshot(snapshot);
    setIsDispersed(true);

    graphRef.current?.d3ReheatSimulation?.();

    // Zoom to fit all nodes after graph updates
    setTimeout(() => {
      graphRef.current?.zoomToFit?.();
    }, 100);
  };

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeContextMenu = () => {
      setContextMenu(null);
    };

    window.addEventListener("click", closeContextMenu);
    return () => {
      window.removeEventListener("click", closeContextMenu);
    };
  }, [contextMenu]);

  useEffect(() => {
    setHasMounted(true);

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        const userId = await getCurrentUserId();
        setCurrentUserId(userId);
        await fetchGraphData();
      })();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [fetchGraphData, getCurrentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      setPendingRequests([]);
      return;
    }

    void loadPendingRequests();
  }, [currentUserId, loadPendingRequests]);

  useEffect(() => {
    if (!currentUserId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadPendingRequests();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentUserId, loadPendingRequests]);

  if (!hasMounted) {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-slate-50 text-slate-500">
        Loading Interactions Network...
      </main>
    );
  }

  return (
    <main className="flex h-screen w-screen flex-col bg-slate-50">
      {/* Header / Control Panel Area */}
      <header className="p-4 bg-white shadow-md z-10 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Interactions Network</h1>
          {isLoading ? <p className="text-sm text-slate-500">Loading graph data...</p> : null}
          <p className="text-xs text-slate-500">
            {currentUserId ? "Signed in" : "Not signed in"}
          </p>
          {!currentUserId ? (
            <p className="text-xs text-slate-500">Use your Supabase email/password account to sign in.</p>
          ) : null}
          <p className="text-xs text-slate-500">Right-click a node or line for actions.</p>
          {authMessage ? <p className="text-sm text-emerald-700">{authMessage}</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
        <div className="space-x-2">
          {!currentUserId ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSignIn();
              }}
            >
              <input
                type="email"
                value={signInEmail}
                onChange={(event) => setSignInEmail(event.target.value)}
                placeholder="Email"
                className="px-3 py-2 border border-slate-300 rounded w-52"
              />
              <input
                type="password"
                value={signInPassword}
                onChange={(event) => setSignInPassword(event.target.value)}
                placeholder="Password"
                className="px-3 py-2 border border-slate-300 rounded w-32"
              />
              <button
                type="submit"
                disabled={isSigningIn}
                className="px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSigningIn ? "Signing in..." : "Sign In"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setAuthMessage(null);
                  setShowAccountRequestForm((current) => !current);
                }}
                disabled={isSigningIn}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {showAccountRequestForm ? "Cancel Request" : "Create Account"}
              </button>
            </form>
          ) : null}
          {currentUserId ? (
            <button
              onClick={() => {
                void handleSignOut();
              }}
              disabled={isSigningIn}
              className="px-4 py-2 bg-slate-500 text-white rounded hover:bg-slate-600 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSigningIn ? "Signing out..." : "Sign Out"}
            </button>
          ) : null}
          {currentUserId ? (
            <>
              <button
                onClick={handleDisperseClusters}
                disabled={isSaving || isSigningIn}
                className="px-4 py-2 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Disperse
              </button>
              <button
                onClick={handleAddPerson}
                disabled={isSaving || isSigningIn}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                + Add Person
              </button>
              <button
                onClick={() => {
                  setError(null);
                  setShowConnectionForm((current) => !current);
                }}
                disabled={isSaving || isSigningIn}
                className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-900 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {showConnectionForm ? "Cancel Connection" : "+ Add Connection"}
              </button>
            </>
          ) : null}
        </div>
      </header>

      <section className="px-4 py-2 bg-white border-t border-slate-200 flex items-center gap-2">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              id="include-friendships"
              type="checkbox"
              checked={includeFriendships}
              onChange={(event) => setIncludeFriendships(event.target.checked)}
              className="h-4 w-4"
            />
            Include friendships
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              id="include-enemies"
              type="checkbox"
              checked={includeEnemies}
              onChange={(event) => setIncludeEnemies(event.target.checked)}
              className="h-4 w-4"
            />
            Include enemies
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              id="include-exes"
              type="checkbox"
              checked={includeExes}
              onChange={(event) => setIncludeExes(event.target.checked)}
              className="h-4 w-4"
            />
            Include exes
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              id="include-lovers"
              type="checkbox"
              checked={includeLovers}
              onChange={(event) => setIncludeLovers(event.target.checked)}
              className="h-4 w-4"
            />
            Include lovers
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              id="include-family"
              type="checkbox"
              checked={includeFamily}
              onChange={(event) => setIncludeFamily(event.target.checked)}
              className="h-4 w-4"
            />
            Include family
          </label>
        </div>
      </section>

      {!currentUserId && showAccountRequestForm ? (
        <section className="p-4 bg-white border-t border-slate-200">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-700">First Name</label>
              <input
                value={requestFirstName}
                onChange={(event) => setRequestFirstName(event.target.value)}
                className="px-3 py-2 border border-slate-300 rounded min-w-40"
                placeholder="First name"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-700">Last Name</label>
              <input
                value={requestLastName}
                onChange={(event) => setRequestLastName(event.target.value)}
                className="px-3 py-2 border border-slate-300 rounded min-w-40"
                placeholder="Last name"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-700">Email</label>
              <input
                type="email"
                value={requestEmail}
                onChange={(event) => setRequestEmail(event.target.value)}
                className="px-3 py-2 border border-slate-300 rounded min-w-56"
                placeholder="name@example.com"
              />
            </div>

            <button
              onClick={() => {
                void handleCreateAccountRequest();
              }}
              disabled={isSigningIn}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSigningIn ? "Submitting..." : "Submit Request"}
            </button>
          </div>
        </section>
      ) : null}

      {currentUserId ? (
        <div className="fixed bottom-4 left-4 w-96 z-20 rounded border border-slate-300 bg-white shadow-lg flex flex-col">
          <div className="flex items-center justify-between gap-2 bg-slate-100 px-4 py-2 border-b border-slate-300 rounded-t">
            <h3 className="text-sm font-semibold text-slate-800">Pending Requests ({pendingRequests.length})</h3>
            <button
              onClick={() => setIsApprovalsMinimized(!isApprovalsMinimized)}
              className="px-2 py-1 text-xs bg-slate-200 rounded hover:bg-slate-300"
            >
              {isApprovalsMinimized ? "▲" : "▼"}
            </button>
          </div>

          {!isApprovalsMinimized ? (
            <>
              <div className="max-h-80 overflow-y-auto p-3 space-y-2">
                {pendingRequests.length === 0 ? (
                  <p className="text-sm text-slate-500">No pending requests.</p>
                ) : (
                  pendingRequests.map((request) => {
                    const displayName = [request.firstName, request.lastName]
                      .filter(Boolean)
                      .join(" ");
                    const isApproving = isApprovingRequestId === request.id;
                    const isDenying = isDenyingRequestId === request.id;

                    return (
                      <div
                        key={request.id}
                        className="rounded border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <p className="text-xs font-medium text-slate-800">
                          {displayName || "No name"}
                        </p>
                        <p className="text-xs text-slate-600">{request.email}</p>
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => {
                              void handleApproveRequest(request.id, request.email);
                            }}
                            disabled={isApproving || isDenying}
                            className="flex-1 px-2 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {isApproving ? "..." : "Approve"}
                          </button>
                          <button
                            onClick={() => {
                              void handleDenyRequest(request.id);
                            }}
                            disabled={isDenying || isApproving}
                            className="flex-1 px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {isDenying ? "..." : "Deny"}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <button
                onClick={() => {
                  void loadPendingRequests();
                }}
                disabled={isLoadingPendingRequests}
                className="w-full px-3 py-1.5 text-xs bg-slate-200 text-slate-700 rounded-b hover:bg-slate-300 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoadingPendingRequests ? "Refreshing..." : "Refresh"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {showConnectionForm ? (
        <section className="p-4 bg-white border-t border-slate-200">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-700">Person A</label>
              <input
                list="node-name-options"
                value={personAQuery}
                onChange={(event) => setPersonAQuery(event.target.value)}
                className="px-3 py-2 border border-slate-300 rounded min-w-48"
                placeholder="Search existing node"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-700">Person B</label>
              <input
                list="node-name-options"
                value={personBQuery}
                onChange={(event) => setPersonBQuery(event.target.value)}
                className="px-3 py-2 border border-slate-300 rounded min-w-48"
                placeholder="Search existing node"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-700">Relationship</label>
              <select
                value={connectionType}
                onChange={(event) => setConnectionType(event.target.value as RelationshipType)}
                className="px-3 py-2 border border-slate-300 rounded min-w-40"
              >
                {RELATIONSHIP_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleAddConnection}
              disabled={isSaving || isSigningIn}
              className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-900 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Save Connection
            </button>
          </div>

          <datalist id="node-name-options">
            {graphData.nodes.map((node) => (
              <option key={node.id} value={node.name} />
            ))}
          </datalist>
        </section>
      ) : null}

      {/* Graph + Agent Area */}
      <div className="flex-grow overflow-hidden flex">
        <div ref={graphAreaRef} className="flex-1 overflow-hidden relative">
          <ForceGraph2D
            ref={graphRef}
            graphData={getVisibleGraphData()}
            linkLabel="type"
            onBackgroundClick={() => setContextMenu(null)}
            onNodeRightClick={(node, event) => {
              const nodeId = getEndpointId((node as { id?: unknown }).id);
              const nodeName = String((node as { name?: unknown }).name ?? "Node");
              if (!nodeId) {
                setError("Unable to determine which node was selected.");
                return;
              }

              openContextMenu(
                {
                  kind: "node",
                  node: {
                    id: nodeId,
                    name: nodeName,
                  },
                },
                event as MouseEvent
              );
            }}
            onLinkRightClick={(link, event) => {
              const sourceId = getEndpointId((link as { source?: unknown }).source);
              const targetId = getEndpointId((link as { target?: unknown }).target);
              if (!sourceId || !targetId) {
                setError("Unable to determine which connection was selected.");
                return;
              }

              openContextMenu(
                {
                  kind: "connection",
                  link: {
                    id: getEndpointId((link as { id?: unknown }).id) ?? undefined,
                    source: sourceId,
                    target: targetId,
                    type: String((link as { type?: unknown }).type ?? "friends"),
                  },
                },
                event as MouseEvent
              );
            }}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const label = String(node.name ?? "");
              if (!label) {
                return;
              }

              const fontSize = 12 / globalScale;
              ctx.font = `${fontSize}px Sans-Serif`;
              ctx.fillStyle = typeof node.color === "string" ? node.color : "#3b82f6";
              ctx.fillText(label, (node.x ?? 0) + 6, (node.y ?? 0) + 3);
            }}
            nodeCanvasObjectMode={() => "after"}
            nodeColor="color"
            linkColor="color"
            linkWidth={2}
          />

          {contextMenu ? (
            <div
              style={{ left: contextMenu.x, top: contextMenu.y }}
              className="absolute z-20 min-w-44 rounded border border-slate-300 bg-white shadow-lg p-1"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                onClick={() => {
                  void handleContextMenuDelete();
                }}
                className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-100"
              >
                {contextMenu.target.kind === "node" ? "Delete Node" : "Delete Connection"}
              </button>
              <button
                onClick={() => {
                  void handleContextMenuEdit();
                }}
                className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-100"
              >
                {contextMenu.target.kind === "node" ? "Edit Name" : "Edit Type"}
              </button>
            </div>
          ) : null}
        </div>

        {currentUserId ? (
          <aside className="w-96 border-l border-slate-200 bg-white flex flex-col">
            <div className="p-3 border-b border-slate-200">
              <h2 className="font-semibold text-slate-800">Social Dynamics Agent</h2>
              <p className="text-xs text-slate-500">Ask questions about group patterns from the graph.</p>
              {agentError ? <p className="mt-1 text-xs text-red-600">{agentError}</p> : null}
            </div>

            {agentMessages.length <= 1 ? (
              <div className="p-3 border-b border-slate-200 space-y-2">
                <p className="text-xs font-semibold text-slate-600 uppercase">Example Prompts</p>
                <div className="space-y-1.5">
                  {EXAMPLE_PROMPTS.map((prompt, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        setAgentQuestion(prompt);
                        // Schedule the send to happen after state update
                        setTimeout(() => {
                          setAgentMessages((current) => [
                            ...current,
                            { role: "user", text: prompt },
                          ]);
                          void (async () => {
                            setIsAgentLoading(true);
                            setAgentError(null);

                            const visible = getVisibleGraphData();
                            const summary = `Nodes: ${visible.nodes.length}, Links: ${visible.links.length}`;

                            try {
                              const response = await fetch("/api/social-agent", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ question: prompt, graphSummary: summary }),
                              });

                              if (!response.ok) {
                                const error = await response.text();
                                throw new Error(error);
                              }

                              const { answer } = (await response.json()) as { answer?: string };
                              setAgentMessages((current) => [
                                ...current,
                                { role: "assistant", text: answer ?? "No response." },
                              ]);
                            } catch (err) {
                              const msg = err instanceof Error ? err.message : "Error querying agent.";
                              setAgentError(msg);
                            } finally {
                              setIsAgentLoading(false);
                              setAgentQuestion("");
                            }
                          })();
                        }, 0);
                      }}
                      className="w-full text-left text-xs p-2 rounded border border-slate-200 hover:bg-violet-50 hover:border-violet-300 text-slate-700 transition"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {agentMessages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={
                    message.role === "user"
                      ? "ml-6 rounded bg-slate-800 text-white p-2 text-sm"
                      : "mr-6 rounded bg-slate-100 text-slate-800 p-2 text-sm"
                  }
                >
                  {message.text}
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-slate-200 space-y-2">
              <textarea
                value={agentQuestion}
                onChange={(event) => setAgentQuestion(event.target.value)}
                rows={3}
                placeholder="Ask a social question..."
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
              <button
                onClick={() => {
                  void handleAskAgent();
                }}
                disabled={isAgentLoading}
                className="w-full px-4 py-2 bg-violet-600 text-white rounded hover:bg-violet-700"
              >
                {isAgentLoading ? "Thinking..." : "Ask Agent"}
              </button>
            </div>
          </aside>
        ) : null}
      </div>
    </main>
  );
}