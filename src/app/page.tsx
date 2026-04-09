"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
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

type Group = {
  id: string;
  name: string;
  color: string;
};

type GroupRecord = {
  id?: unknown;
  name?: unknown;
  color?: unknown;
};

type GroupMembershipRecord = {
  node_id?: unknown;
  nodeId?: unknown;
  group_id?: unknown;
  groupId?: unknown;
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

type EventAttendee = {
  id: string;
  name: string;
  existingNodeId?: string;
};

type PlannedEvent = {
  id: string;
  name: string;
  attendees: EventAttendee[];
  createdAt: string;
};

type PlannedEventRecord = {
  id?: unknown;
  user_id?: unknown;
  name?: unknown;
  attendees?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
};

type PendingEventConfirmation = {
  eventName: string;
  attendeeNames: string[];
  sourceQuestion: string;
  shouldSuggestMore: boolean;
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
      kind: "group";
      group: {
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
const EVENT_TABLE_CANDIDATES = ["planned_events", "events"] as const;
const GROUP_TABLE_CANDIDATES = ["groups"] as const;
const GROUP_MEMBERSHIP_TABLE_CANDIDATES = ["group_memberships", "node_groups"] as const;
const RELATIONSHIP_OPTIONS = ["friends", "coworkers", "exes", "lovers", "enemies", "family"] as const;
type RelationshipType = (typeof RELATIONSHIP_OPTIONS)[number];
const RELATIONSHIP_COLORS: Record<RelationshipType, string> = {
  friends: "#22c55e",
  coworkers: "#6b7280",
  exes: "#000000",
  lovers: "#ec4899",
  enemies: "#ef4444",
  family: "#8b5cf6",
};
const GROUP_COLORS = ["#2563eb", "#0d9488", "#7c3aed", "#f97316", "#db2777", "#16a34a"] as const;

const hasMissingColumnError = (message: string | undefined, column: string) => {
  return (message ?? "").includes(`Could not find the '${column}' column`);
};

const hasMissingTableError = (message: string | undefined, table: string) => {
  return (message ?? "").includes(`Could not find the table 'public.${table}'`);
};

const normalizePersonName = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const normalizeGroupName = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

const getLinkEndpointId = (endpoint: unknown) => {
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

// Next.js requires graph libraries to be loaded dynamically on the client side
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

const EXAMPLE_PROMPTS = [
  "Who are the most connected people in this network?",
  "Map out distinct friend groups and clusters.",
  "Suggest an event guest list that would minimize relationship tension.",
];

export default function NetworkGraph() {
  const topHeaderRef = useRef<HTMLElement | null>(null);
  const graphRef = useRef<
    ForceGraphMethods<NodeObject, LinkObject> | undefined
  >(undefined);
  const graphAreaRef = useRef<HTMLDivElement | null>(null);
  const agentMessagesScrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollAgentMessagesRef = useRef(true);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [includeFriendships, setIncludeFriendships] = useState(true);
  const [includeCoworkers, setIncludeCoworkers] = useState(true);
  const [includeExes, setIncludeExes] = useState(true);
  const [includeEnemies, setIncludeEnemies] = useState(true);
  const [includeLovers, setIncludeLovers] = useState(true);
  const [includeFamily, setIncludeFamily] = useState(true);
  const [groupViewMode, setGroupViewMode] = useState<"all" | "highlight" | "only">("all");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [nodeGroupIdsByNodeId, setNodeGroupIdsByNodeId] = useState<Record<string, string[]>>({});
  const [groupTable, setGroupTable] = useState<string | null>(null);
  const [groupMembershipTable, setGroupMembershipTable] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [showCreateGroupForm, setShowCreateGroupForm] = useState(false);
  const [showEditGroupForm, setShowEditGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupSelectedNodeIds, setNewGroupSelectedNodeIds] = useState<string[]>([]);
  const [createGroupError, setCreateGroupError] = useState<string | null>(null);
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
  const [isApprover, setIsApprover] = useState(false);
  const [isLoadingPendingRequests, setIsLoadingPendingRequests] = useState(false);
  const [isApprovingRequestId, setIsApprovingRequestId] = useState<string | null>(null);
  const [isDenyingRequestId, setIsDenyingRequestId] = useState<string | null>(null);
  const [isApprovalsMinimized, setIsApprovalsMinimized] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<"agent" | "events">("agent");
  const [isSidebarMinimized, setIsSidebarMinimized] = useState(false);
  const [plannedEvents, setPlannedEvents] = useState<PlannedEvent[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [pendingEventConfirmation, setPendingEventConfirmation] =
    useState<PendingEventConfirmation | null>(null);
  const [pendingEventDraftName, setPendingEventDraftName] = useState("");
  const [pendingEventDraftAttendees, setPendingEventDraftAttendees] = useState<string[]>([]);
  const [pendingEventAttendeeQuery, setPendingEventAttendeeQuery] = useState("");
  const [pendingEventConfirmationError, setPendingEventConfirmationError] = useState<string | null>(null);
  const [eventDraftName, setEventDraftName] = useState("");
  const [eventAttendeeQuery, setEventAttendeeQuery] = useState("");
  const [eventDraftAttendees, setEventDraftAttendees] = useState<EventAttendee[]>([]);
  const [eventError, setEventError] = useState<string | null>(null);
  const [personAQuery, setPersonAQuery] = useState("");
  const [personBQuery, setPersonBQuery] = useState("");
  const [connectionType, setConnectionType] = useState<RelationshipType>("friends");
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentQuestion, setAgentQuestion] = useState("");
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [rightPanelTop, setRightPanelTop] = useState(88);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    {
      role: "assistant",
      text:
        "Ask about group dynamics. Example: Who should I invite to maximize friends with no enemies present?",
    },
  ]);

  const handleAgentMessagesScroll = useCallback(() => {
    const container = agentMessagesScrollRef.current;
    if (!container) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollAgentMessagesRef.current = distanceFromBottom <= 64;
  }, []);

  useEffect(() => {
    const container = agentMessagesScrollRef.current;
    if (!container) {
      return;
    }

    if (shouldAutoScrollAgentMessagesRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [agentMessages, isAgentLoading]);

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

  const normalizeGroups = useCallback((data: GroupRecord[]) => {
    const seenIds = new Set<string>();

    return data
      .map((group, index) => {
        const id = typeof group.id === "string" ? group.id.trim() : "";
        const name = typeof group.name === "string" ? group.name.trim() : "";

        if (!id || !name || seenIds.has(id)) {
          return null;
        }

        seenIds.add(id);

        return {
          id,
          name,
          color:
            typeof group.color === "string" && group.color
              ? group.color
              : GROUP_COLORS[index % GROUP_COLORS.length],
        };
      })
      .filter(Boolean) as Group[];
  }, []);

  const normalizeGroupMemberships = useCallback((
    data: GroupMembershipRecord[],
    nodeIds: Set<string>,
    groupIds: Set<string>
  ) => {
    const seenPairs = new Set<string>();
    const nextMap: Record<string, string[]> = {};

    for (const membership of data) {
      const nodeIdSource = membership.node_id ?? membership.nodeId;
      const groupIdSource = membership.group_id ?? membership.groupId;
      const nodeId = typeof nodeIdSource === "string" ? nodeIdSource : "";
      const groupId = typeof groupIdSource === "string" ? groupIdSource : "";

      if (!nodeId || !groupId || !nodeIds.has(nodeId) || !groupIds.has(groupId)) {
        continue;
      }

      const key = `${nodeId}:${groupId}`;
      if (seenPairs.has(key)) {
        continue;
      }

      seenPairs.add(key);
      nextMap[nodeId] = [...(nextMap[nodeId] ?? []), groupId];
    }

    return nextMap;
  }, []);

  const isRelationshipVisible = useCallback(
    (type: string) => {
      const normalizedType = type.toLowerCase();
      switch (normalizedType) {
        case "friends":
          return includeFriendships;
        case "coworkers":
          return includeCoworkers;
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
    },
    [
      includeCoworkers,
      includeEnemies,
      includeExes,
      includeFamily,
      includeFriendships,
      includeLovers,
    ]
  );

  const selectedGroupIdSet = useMemo(() => new Set(selectedGroupIds), [selectedGroupIds]);

  const groupById = useMemo(() => {
    return new Map(groups.map((group) => [group.id, group]));
  }, [groups]);

  const isNodeInSelectedGroup = useCallback(
    (nodeId: string) => {
      if (selectedGroupIdSet.size === 0) {
        return false;
      }

      return (nodeGroupIdsByNodeId[nodeId] ?? []).some((groupId) => selectedGroupIdSet.has(groupId));
    },
    [nodeGroupIdsByNodeId, selectedGroupIdSet]
  );

  const groupCounts = useMemo(() => {
    const countsByGroupId = new Map<string, number>();

    for (const memberships of Object.values(nodeGroupIdsByNodeId)) {
      for (const groupId of memberships) {
        countsByGroupId.set(groupId, (countsByGroupId.get(groupId) ?? 0) + 1);
      }
    }

    return groups.map((group) => ({ group, count: countsByGroupId.get(group.id) ?? 0 }));
  }, [groups, nodeGroupIdsByNodeId]);

  const alphabetizedGroupNodes = useMemo(() => {
    return [...graphData.nodes].sort((leftNode, rightNode) => {
      const nameComparison = leftNode.name.localeCompare(rightNode.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });

      if (nameComparison !== 0) {
        return nameComparison;
      }

      return leftNode.id.localeCompare(rightNode.id, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
  }, [graphData.nodes]);

  const visibleGraphData = useMemo(
    () => ({
      nodes: graphData.nodes,
      links: graphData.links.filter((link) => isRelationshipVisible(String(link.type))),
    }),
    [graphData.nodes, graphData.links, isRelationshipVisible]
  );

  const groupFilteredGraphData = useMemo(() => {
    if (groupViewMode !== "only" || selectedGroupIdSet.size === 0) {
      return visibleGraphData;
    }

    const includedNodeIds = new Set(
      visibleGraphData.nodes
        .filter((node) => (nodeGroupIdsByNodeId[node.id] ?? []).some((groupId) => selectedGroupIdSet.has(groupId)))
        .map((node) => node.id)
    );

    return {
      nodes: visibleGraphData.nodes.filter((node) => includedNodeIds.has(node.id)),
      links: visibleGraphData.links.filter((link) => {
        const source = getLinkEndpointId((link as { source?: unknown }).source);
        const target = getLinkEndpointId((link as { target?: unknown }).target);

        if (!source || !target) {
          return false;
        }

        return includedNodeIds.has(source) && includedNodeIds.has(target);
      }),
    };
  }, [groupViewMode, nodeGroupIdsByNodeId, selectedGroupIdSet, visibleGraphData]);

  const selectedEvent = useMemo(
    () => plannedEvents.find((event) => event.id === selectedEventId) ?? null,
    [plannedEvents, selectedEventId]
  );

  const eventGraphData = useMemo(() => {
    if (!selectedEvent) {
      return null;
    }

    const networkNodeById = new Map(graphData.nodes.map((node) => [node.id, node]));
    const nodes: Array<GraphNode & { isEventOnly?: boolean }> = [];
    const nodeIds = new Set<string>();

    for (const attendee of selectedEvent.attendees) {
      const existingNode = attendee.existingNodeId
        ? networkNodeById.get(attendee.existingNodeId)
        : undefined;

      if (existingNode) {
        if (!nodeIds.has(existingNode.id)) {
          nodes.push(existingNode);
          nodeIds.add(existingNode.id);
        }
        continue;
      }

      const customId = attendee.id;
      if (!nodeIds.has(customId)) {
        nodes.push({
          id: customId,
          name: attendee.name,
          color: "#9ca3af",
          isEventOnly: true,
        });
        nodeIds.add(customId);
      }
    }

    const links = groupFilteredGraphData.links.filter((link) => {
      const source = getLinkEndpointId((link as { source?: unknown }).source);
      const target = getLinkEndpointId((link as { target?: unknown }).target);

      if (!source || !target) {
        return false;
      }

      return nodeIds.has(source) && nodeIds.has(target);
    });

    return { nodes, links };
  }, [graphData.nodes, selectedEvent, groupFilteredGraphData.links]);

  const activeGraphData = selectedEvent
    ? eventGraphData ?? groupFilteredGraphData
    : groupFilteredGraphData;

  const getRenderedNodeColor = useCallback(
    (node: NodeObject) => {
      const baseColor = typeof node.color === "string" && node.color ? node.color : "#3b82f6";

      if (selectedEvent || groupViewMode !== "highlight" || selectedGroupIdSet.size === 0) {
        return baseColor;
      }

      const nodeId = getLinkEndpointId((node as { id?: unknown }).id);
      if (!nodeId || isNodeInSelectedGroup(nodeId)) {
        return baseColor;
      }

      return "#cbd5e1";
    },
    [groupViewMode, isNodeInSelectedGroup, selectedEvent, selectedGroupIdSet]
  );

  const getRenderedLinkColor = useCallback(
    (link: LinkObject) => {
      const baseColor = typeof link.color === "string" && link.color ? link.color : "#94a3b8";

      if (selectedEvent || groupViewMode !== "highlight" || selectedGroupIdSet.size === 0) {
        return baseColor;
      }

      const sourceId = getLinkEndpointId((link as { source?: unknown }).source);
      const targetId = getLinkEndpointId((link as { target?: unknown }).target);

      if (!sourceId || !targetId) {
        return "#e2e8f0";
      }

      return isNodeInSelectedGroup(sourceId) && isNodeInSelectedGroup(targetId)
        ? baseColor
        : "#e2e8f0";
    },
    [groupViewMode, isNodeInSelectedGroup, selectedEvent, selectedGroupIdSet]
  );

  const getRenderedLinkWidth = useCallback(
    (link: LinkObject) => {
      if (selectedEvent || groupViewMode !== "highlight" || selectedGroupIdSet.size === 0) {
        return 2;
      }

      const sourceId = getLinkEndpointId((link as { source?: unknown }).source);
      const targetId = getLinkEndpointId((link as { target?: unknown }).target);

      if (!sourceId || !targetId) {
        return 1;
      }

      return isNodeInSelectedGroup(sourceId) && isNodeInSelectedGroup(targetId) ? 2 : 1;
    },
    [groupViewMode, isNodeInSelectedGroup, selectedEvent, selectedGroupIdSet]
  );

  const getEventStorageKey = useCallback(
    (userId: string) => `interaction-network-events:${userId}`,
    []
  );

  const normalizeEventAttendees = useCallback(
    (attendees: unknown, eventId: string): EventAttendee[] => {
      if (!Array.isArray(attendees)) {
        return [];
      }

      return attendees
        .map((attendee, index) => {
          if (!attendee || typeof attendee !== "object") {
            return null;
          }

          const rawName = (attendee as { name?: unknown }).name;
          const name = typeof rawName === "string" ? rawName.trim() : "";
          if (!name) {
            return null;
          }

          const rawExistingNodeId = (attendee as { existingNodeId?: unknown }).existingNodeId;
          const rawId = (attendee as { id?: unknown }).id;

          return {
            id:
              typeof rawId === "string" && rawId.trim()
                ? rawId.trim()
                : `${eventId}:attendee:${index}`,
            name,
            existingNodeId: typeof rawExistingNodeId === "string" ? rawExistingNodeId : undefined,
          };
        })
        .filter(Boolean) as EventAttendee[];
    },
    []
  );

  const normalizePlannedEventRecord = useCallback(
    (row: PlannedEventRecord, index: number): PlannedEvent | null => {
      const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : `event-${index}`;
      const name = typeof row.name === "string" ? row.name.trim() : "";

      if (!name) {
        return null;
      }

      const createdAtSource =
        typeof row.created_at === "string"
          ? row.created_at
          : typeof row.createdAt === "string"
            ? row.createdAt
            : new Date().toISOString();

      return {
        id,
        name,
        attendees: normalizeEventAttendees(row.attendees, id),
        createdAt: createdAtSource,
      };
    },
    [normalizeEventAttendees]
  );

  const loadPlannedEvents = useCallback(async () => {
    if (!currentUserId) {
      setPlannedEvents([]);
      return;
    }

    setIsLoadingEvents(true);
    setEventError(null);

    for (const table of EVENT_TABLE_CANDIDATES) {
      const scopedResult = await supabase
        .from(table)
        .select("id,name,attendees,created_at,user_id")
        .eq("user_id", currentUserId)
        .order("created_at", { ascending: false });

      if (scopedResult.error) {
        if (hasMissingTableError(scopedResult.error.message, table)) {
          continue;
        }

        setEventError(scopedResult.error.message);
        setIsLoadingEvents(false);
        return;
      }

      const normalized = ((scopedResult.data ?? []) as PlannedEventRecord[])
        .map((row, index) => normalizePlannedEventRecord(row, index))
        .filter(Boolean) as PlannedEvent[];

      setPlannedEvents(normalized);
      setIsLoadingEvents(false);
      return;
    }

    const localKey = getEventStorageKey(currentUserId);
    const stored = window.localStorage.getItem(localKey);

    if (!stored) {
      setPlannedEvents([]);
      setEventError(
        "Create a planned_events table in Supabase to store account-specific events across devices."
      );
      setIsLoadingEvents(false);
      return;
    }

    try {
      const parsed = JSON.parse(stored) as unknown;
      const normalized = Array.isArray(parsed)
        ? parsed
            .map((row, index) => {
              if (!row || typeof row !== "object") {
                return null;
              }

              const id =
                typeof (row as { id?: unknown }).id === "string" &&
                (row as { id?: string }).id?.trim()
                  ? (row as { id: string }).id.trim()
                  : `event-${index}`;
              const name =
                typeof (row as { name?: unknown }).name === "string"
                  ? (row as { name: string }).name.trim()
                  : "";

              if (!name) {
                return null;
              }

              return {
                id,
                name,
                attendees: normalizeEventAttendees((row as { attendees?: unknown }).attendees, id),
                createdAt:
                  typeof (row as { createdAt?: unknown }).createdAt === "string"
                    ? (row as { createdAt: string }).createdAt
                    : new Date().toISOString(),
              };
            })
            .filter(Boolean)
        : [];

      setPlannedEvents(normalized as PlannedEvent[]);
      setEventError(
        "Create a planned_events table in Supabase to store account-specific events across devices."
      );
    } catch {
      setPlannedEvents([]);
      setEventError("Unable to read stored events from this browser.");
    } finally {
      setIsLoadingEvents(false);
    }
  }, [currentUserId, getEventStorageKey, normalizeEventAttendees, normalizePlannedEventRecord]);

  const savePlannedEventsToLocalStorage = useCallback(
    (events: PlannedEvent[]) => {
      if (!currentUserId) {
        return;
      }

      window.localStorage.setItem(getEventStorageKey(currentUserId), JSON.stringify(events));
    },
    [currentUserId, getEventStorageKey]
  );

  const getGroupStorageKey = useCallback(
    (userId: string) => `interaction-network-groups:${userId}`,
    []
  );

  const saveGroupsToLocalStorage = useCallback(
    (nextGroups: Group[], nextMembershipsByNodeId: Record<string, string[]>) => {
      if (!currentUserId) {
        return;
      }

      window.localStorage.setItem(
        getGroupStorageKey(currentUserId),
        JSON.stringify({ groups: nextGroups, memberships: nextMembershipsByNodeId })
      );
    },
    [currentUserId, getGroupStorageKey]
  );

  const fetchGroupsFromAvailableTable = useCallback(async (userId: string) => {
    for (const table of GROUP_TABLE_CANDIDATES) {
      let scopedResult = await supabase.from(table).select("*").eq("user_id", userId);

      if (scopedResult.error && hasMissingColumnError(scopedResult.error.message, "user_id")) {
        scopedResult = await supabase.from(table).select("*");
      }

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

  const fetchGroupMembershipsFromAvailableTable = useCallback(async (userId: string) => {
    for (const table of GROUP_MEMBERSHIP_TABLE_CANDIDATES) {
      let scopedResult = await supabase.from(table).select("*").eq("user_id", userId);

      if (scopedResult.error && hasMissingColumnError(scopedResult.error.message, "user_id")) {
        scopedResult = await supabase.from(table).select("*");
      }

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

  const fetchGraphData = useCallback(async (userIdOverride?: string | null) => {
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
    const effectiveUserId = userIdOverride ?? currentUserId;

    if (effectiveUserId) {
      const groupsLookup = await fetchGroupsFromAvailableTable(effectiveUserId);
      const membershipsLookup = await fetchGroupMembershipsFromAvailableTable(effectiveUserId);

      if (groupsLookup.error || membershipsLookup.error) {
        setGroupError(
          groupsLookup.error?.message ??
            membershipsLookup.error?.message ??
            "Unable to load groups from Supabase."
        );
      } else if (groupsLookup.table && membershipsLookup.table) {
        const normalizedGroups = normalizeGroups((groupsLookup.data ?? []) as GroupRecord[]);
        const nodeIds = new Set(nodes.map((node) => node.id));
        const groupIds = new Set(normalizedGroups.map((group) => group.id));
        const membershipsByNodeId = normalizeGroupMemberships(
          (membershipsLookup.data ?? []) as GroupMembershipRecord[],
          nodeIds,
          groupIds
        );

        setGroups(normalizedGroups);
        setNodeGroupIdsByNodeId(membershipsByNodeId);
        setGroupTable(groupsLookup.table);
        setGroupMembershipTable(membershipsLookup.table);
        setGroupError(null);
      } else {
        const localKey = getGroupStorageKey(effectiveUserId);
        const stored = window.localStorage.getItem(localKey);

        if (!stored) {
          setGroups([]);
          setNodeGroupIdsByNodeId({});
          setGroupTable(null);
          setGroupMembershipTable(null);
          setGroupError(
            "Create groups and group_memberships tables in Supabase to persist groups across devices."
          );
        } else {
          try {
            const parsed = JSON.parse(stored) as {
              groups?: GroupRecord[];
              memberships?: Record<string, string[]>;
            };
            const normalizedGroups = normalizeGroups(parsed.groups ?? []);
            const nodeIds = new Set(nodes.map((node) => node.id));
            const groupIds = new Set(normalizedGroups.map((group) => group.id));
            const rawMemberships = parsed.memberships ?? {};
            const membershipsByNodeId: Record<string, string[]> = {};

            for (const [nodeId, groupIdList] of Object.entries(rawMemberships)) {
              if (!nodeIds.has(nodeId) || !Array.isArray(groupIdList)) {
                continue;
              }

              membershipsByNodeId[nodeId] = groupIdList.filter(
                (groupId) => typeof groupId === "string" && groupIds.has(groupId)
              );
            }

            setGroups(normalizedGroups);
            setNodeGroupIdsByNodeId(membershipsByNodeId);
            setGroupTable(null);
            setGroupMembershipTable(null);
            setGroupError(
              "Create groups and group_memberships tables in Supabase to persist groups across devices."
            );
          } catch {
            setGroups([]);
            setNodeGroupIdsByNodeId({});
            setGroupTable(null);
            setGroupMembershipTable(null);
            setGroupError("Unable to read group data stored in this browser.");
          }
        }
      }
    } else {
      setGroups([]);
      setNodeGroupIdsByNodeId({});
      setGroupTable(null);
      setGroupMembershipTable(null);
      setGroupError(null);
    }

    setError(null);
    setRelationTable(linksLookup.table);
    setGraphData({ nodes, links });

    setIsLoading(false);
  }, [
    currentUserId,
    fetchGroupMembershipsFromAvailableTable,
    fetchGroupsFromAvailableTable,
    fetchLinksFromAvailableTable,
    getGroupStorageKey,
    normalizeGroupMemberships,
    normalizeGroups,
  ]);

  const handleAddPerson = async () => {
    if (!currentUserId) {
      setError("You must be signed in before adding a person.");
      return;
    }

    const name = window.prompt("Enter the person's name:")?.trim();
    if (!name) {
      return;
    }

    const existingNames = new Set(graphData.nodes.map((node) => normalizePersonName(node.name)));

    if (existingNames.has(normalizePersonName(name))) {
      const romanNumerals = ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
      let suggestedName = `${name} II`;

      for (const numeral of romanNumerals) {
        const candidate = `${name} ${numeral}`;
        if (!existingNames.has(normalizePersonName(candidate))) {
          suggestedName = candidate;
          break;
        }
      }

      setError(`A person named "${name}" already exists. Try "${suggestedName}".`);
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

  const handleAddEventAttendee = (attendeeNameInput?: string) => {
    const attendeeName = (attendeeNameInput ?? eventAttendeeQuery).trim();
    if (!attendeeName) {
      setEventError("Enter a name to add as an attendee.");
      return;
    }

    const matchingNode = graphData.nodes.find(
      (node) => normalizePersonName(node.name) === normalizePersonName(attendeeName)
    );

    const duplicateExists = eventDraftAttendees.some((attendee) => {
      if (attendee.existingNodeId && matchingNode) {
        return attendee.existingNodeId === matchingNode.id;
      }

      return normalizePersonName(attendee.name) === normalizePersonName(attendeeName);
    });

    if (duplicateExists) {
      return;
    }

    const nextAttendee: EventAttendee = matchingNode
      ? {
          id: `existing:${matchingNode.id}`,
          name: matchingNode.name,
          existingNodeId: matchingNode.id,
        }
      : {
          id: `custom:${crypto.randomUUID()}`,
          name: attendeeName,
        };

    setEventDraftAttendees((current) => [...current, nextAttendee]);
    setEventAttendeeQuery("");
    setEventError(null);
  };

  const handleRemoveEventAttendee = (attendeeId: string) => {
    setEventDraftAttendees((current) => current.filter((attendee) => attendee.id !== attendeeId));
  };

  const handleCreateEvent = async () => {
    const eventName = eventDraftName.trim();
    const isEditingEvent = editingEventId !== null;
    const existingEvent = isEditingEvent
      ? plannedEvents.find((entry) => entry.id === editingEventId)
      : null;

    if (!eventName) {
      setEventError("Give the event a name.");
      return;
    }

    if (eventDraftAttendees.length === 0) {
      setEventError("Add at least one attendee to create the event.");
      return;
    }

    if (!currentUserId) {
      setEventError("You must be signed in before creating events.");
      return;
    }

    const event: PlannedEvent = {
      id: isEditingEvent ? String(editingEventId) : crypto.randomUUID(),
      name: eventName,
      attendees: eventDraftAttendees,
      createdAt: existingEvent?.createdAt ?? new Date().toISOString(),
    };

    setIsLoadingEvents(true);
    setEventError(null);

    let savedRemotely = false;

    for (const table of EVENT_TABLE_CANDIDATES) {
      if (isEditingEvent) {
        const updateResult = await supabase
          .from(table)
          .update({
            name: event.name,
            attendees: event.attendees,
          })
          .eq("id", event.id)
          .eq("user_id", currentUserId);

        if (updateResult.error) {
          if (hasMissingTableError(updateResult.error.message, table)) {
            continue;
          }

          if (hasMissingColumnError(updateResult.error.message, "attendees")) {
            const retryResult = await supabase
              .from(table)
              .update({ name: event.name })
              .eq("id", event.id)
              .eq("user_id", currentUserId);

            if (retryResult.error) {
              setEventError(retryResult.error.message);
              setIsLoadingEvents(false);
              return;
            }

            savedRemotely = true;
            break;
          }

          setEventError(updateResult.error.message);
          setIsLoadingEvents(false);
          return;
        }

        savedRemotely = true;
        break;
      }

      const insertResult = await supabase.from(table).insert({
        id: event.id,
        user_id: currentUserId,
        name: event.name,
        attendees: event.attendees,
        created_at: event.createdAt,
      });

      if (insertResult.error) {
        if (hasMissingTableError(insertResult.error.message, table)) {
          continue;
        }

        if (hasMissingColumnError(insertResult.error.message, "attendees")) {
          const retryResult = await supabase.from(table).insert({
            id: event.id,
            user_id: currentUserId,
            name: event.name,
            created_at: event.createdAt,
          });

          if (retryResult.error) {
            setEventError(retryResult.error.message);
            setIsLoadingEvents(false);
            return;
          }

          savedRemotely = true;
          break;
        }

        setEventError(insertResult.error.message);
        setIsLoadingEvents(false);
        return;
      }

      savedRemotely = true;
      break;
    }

    if (!savedRemotely) {
      const nextEvents = isEditingEvent
        ? plannedEvents.map((entry) => (entry.id === event.id ? event : entry))
        : [event, ...plannedEvents];

      savePlannedEventsToLocalStorage(nextEvents);
      setPlannedEvents(nextEvents);
      setSelectedEventId(event.id);
      setSidebarTab("events");
      setEventDraftName("");
      setEventAttendeeQuery("");
      setEventDraftAttendees([]);
      setEditingEventId(null);
      setEventError(
        isEditingEvent
          ? "Updated locally in this browser. Create a planned_events table in Supabase to sync edits across devices."
          : "Create a planned_events table in Supabase to store account-specific events across devices."
      );
      setIsLoadingEvents(false);
      return;
    }

    await loadPlannedEvents();
    setSelectedEventId(event.id);
    setSidebarTab("events");
    setEventDraftName("");
    setEventAttendeeQuery("");
    setEventDraftAttendees([]);
    setEditingEventId(null);
    setEventError(null);
    setIsLoadingEvents(false);
  };

  const handleSelectEvent = (eventId: string) => {
    setSelectedEventId(eventId);
    setSidebarTab("events");
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!currentUserId) {
      setEventError("You must be signed in before deleting events.");
      return;
    }

    const event = plannedEvents.find((entry) => entry.id === eventId);
    if (!event) {
      setEventError("Unable to find the selected event.");
      return;
    }

    const confirmed = window.confirm(`Delete event "${event.name}"?`);
    if (!confirmed) {
      return;
    }

    setIsLoadingEvents(true);
    setEventError(null);

    let deletedRemotely = false;

    for (const table of EVENT_TABLE_CANDIDATES) {
      const deleteResult = await supabase
        .from(table)
        .delete()
        .eq("id", eventId)
        .eq("user_id", currentUserId);

      if (deleteResult.error) {
        if (hasMissingTableError(deleteResult.error.message, table)) {
          continue;
        }

        setEventError(deleteResult.error.message);
        setIsLoadingEvents(false);
        return;
      }

      deletedRemotely = true;
      break;
    }

    const nextEvents = plannedEvents.filter((entry) => entry.id !== eventId);
    savePlannedEventsToLocalStorage(nextEvents);
    setPlannedEvents(nextEvents);

    if (selectedEventId === eventId) {
      setSelectedEventId(null);
    }

    if (editingEventId === eventId) {
      setEditingEventId(null);
      setEventDraftName("");
      setEventAttendeeQuery("");
      setEventDraftAttendees([]);
      setEventError(null);
    }

    if (!deletedRemotely) {
      setEventError(
        "Deleted locally in this browser. Add a planned_events table in Supabase to sync deletions across devices."
      );
      setIsLoadingEvents(false);
      return;
    }

    setIsLoadingEvents(false);
  };

  const handleBeginEditEvent = (eventId: string) => {
    const event = plannedEvents.find((entry) => entry.id === eventId);
    if (!event) {
      setEventError("Unable to find the selected event.");
      return;
    }

    setEditingEventId(event.id);
    setSelectedEventId(event.id);
    setSidebarTab("events");
    setEventDraftName(event.name);
    setEventAttendeeQuery("");
    setEventDraftAttendees(event.attendees);
    setEventError(null);
  };

  const handleCancelEventEdit = () => {
    setEditingEventId(null);
    setEventDraftName("");
    setEventAttendeeQuery("");
    setEventDraftAttendees([]);
    setEventError(null);
  };

  const handleClearSelectedEvent = () => {
    setSelectedEventId(null);
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
    await fetchGraphData(userId);
    setIsSigningIn(false);
  };

  const loadApproverStatus = useCallback(async () => {
    if (!currentUserId) {
      setIsApprover(false);
      return;
    }

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.access_token) {
      setIsApprover(false);
      return;
    }

    const response = await fetch("/api/admin/approver-status", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) {
      setIsApprover(false);
      return;
    }

    const data = (await response.json()) as { isApprover?: boolean };
    setIsApprover(Boolean(data.isApprover));
  }, [currentUserId]);

  const loadPendingRequests = useCallback(async () => {
    if (!currentUserId || !isApprover) {
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
  }, [currentUserId, isApprover]);

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
    setIsApprover(false);
    setPlannedEvents([]);
    setSelectedEventId(null);
    setEditingEventId(null);
    setPendingEventConfirmation(null);
    setEventDraftName("");
    setEventAttendeeQuery("");
    setEventDraftAttendees([]);
    setEventError(null);
    setPersonAQuery("");
    setPersonBQuery("");
    setConnectionType("friends");
    setGroupViewMode("all");
    setSelectedGroupIds([]);
    setGroups([]);
    setNodeGroupIdsByNodeId({});
    setGroupTable(null);
    setGroupMembershipTable(null);
    setGroupError(null);
    setShowCreateGroupForm(false);
    setShowEditGroupForm(false);
    setNewGroupName("");
    setNewGroupSelectedNodeIds([]);
    setCreateGroupError(null);
    setIsApprovalsMinimized(true);
    setIsSidebarMinimized(false);
    setIsSigningIn(false);
  };

  const handleToggleCreateGroupNode = (nodeId: string) => {
    setNewGroupSelectedNodeIds((current) =>
      current.includes(nodeId)
        ? current.filter((id) => id !== nodeId)
        : [...current, nodeId]
    );
  };

  const handleOpenCreateGroupForm = () => {
    if (!currentUserId) {
      setError("You must be signed in before creating a group.");
      return;
    }

    setCreateGroupError(null);
    setNewGroupName("");
    setNewGroupSelectedNodeIds([]);
    setShowCreateGroupForm(true);
  };

  const handleOpenEditGroupForm = (groupId?: string) => {
    if (!currentUserId) {
      setError("You must be signed in before editing groups.");
      return;
    }

    const targetGroupId = groupId ?? (selectedGroupIds.length === 1 ? selectedGroupIds[0] : "");

    if (!targetGroupId) {
      setCreateGroupError(
        selectedGroupIds.length > 1 ? "Select exactly one group to edit." : "Choose a group to edit."
      );
      return;
    }

    const targetGroup = groups.find((group) => group.id === targetGroupId);
    if (!targetGroup) {
      setCreateGroupError("Unable to find the selected group.");
      return;
    }

    const selectedNodeIds = graphData.nodes
      .filter((node) => (nodeGroupIdsByNodeId[node.id] ?? []).includes(targetGroup.id))
      .map((node) => node.id);

    setNewGroupName(targetGroup.name);
    setNewGroupSelectedNodeIds(selectedNodeIds);
    setCreateGroupError(null);
    setShowEditGroupForm(true);
  };

  const handleCreateGroup = async () => {
    if (!currentUserId) {
      setCreateGroupError("You must be signed in before creating a group.");
      return;
    }

    const name = newGroupName.trim();
    if (!name) {
      setCreateGroupError("Enter a group name.");
      return;
    }

    if (newGroupSelectedNodeIds.length === 0) {
      setCreateGroupError("Select at least one person for this group.");
      return;
    }

    if (groups.some((group) => normalizeGroupName(group.name) === normalizeGroupName(name))) {
      setCreateGroupError("A group with this name already exists.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setGroupError(null);
    setCreateGroupError(null);

    let createdGroup: Group | null = null;
    let persistenceFailed: string | null = null;

    if (groupTable && groupMembershipTable) {
      const color = GROUP_COLORS[groups.length % GROUP_COLORS.length];
      const groupPayloads = [
        { name, color, user_id: currentUserId },
        { name, user_id: currentUserId },
        { name, color },
        { name },
      ];

      for (const payload of groupPayloads) {
        const insertResult = await supabase.from(groupTable).insert(payload).select("*").single();

        if (insertResult.error) {
          if (
            hasMissingColumnError(insertResult.error.message, "color") ||
            hasMissingColumnError(insertResult.error.message, "user_id")
          ) {
            continue;
          }

          persistenceFailed = insertResult.error.message;
          break;
        }

        const row = insertResult.data as GroupRecord;
        if (typeof row.id !== "string" || typeof row.name !== "string") {
          persistenceFailed = "Unable to read created group.";
          break;
        }

        createdGroup = {
          id: row.id,
          name: row.name,
          color: typeof row.color === "string" && row.color ? row.color : color,
        };
        break;
      }

      if (createdGroup && !persistenceFailed) {
        for (const nodeId of newGroupSelectedNodeIds) {
          const membershipPayloads = [
            { node_id: nodeId, group_id: createdGroup.id, user_id: currentUserId },
            { node_id: nodeId, group_id: createdGroup.id },
            { nodeId, groupId: createdGroup.id, user_id: currentUserId },
            { nodeId, groupId: createdGroup.id },
          ];

          let inserted = false;

          for (const payload of membershipPayloads) {
            const insertResult = await supabase.from(groupMembershipTable).insert(payload);

            if (insertResult.error) {
              if (
                hasMissingColumnError(insertResult.error.message, "node_id") ||
                hasMissingColumnError(insertResult.error.message, "group_id") ||
                hasMissingColumnError(insertResult.error.message, "nodeId") ||
                hasMissingColumnError(insertResult.error.message, "groupId") ||
                hasMissingColumnError(insertResult.error.message, "user_id")
              ) {
                continue;
              }

              persistenceFailed = insertResult.error.message;
              break;
            }

            inserted = true;
            break;
          }

          if (!inserted) {
            if (!persistenceFailed) {
              persistenceFailed = "Unable to create group memberships.";
            }
            break;
          }
        }
      }
    }

    if (createdGroup && !persistenceFailed) {
      await fetchGraphData(currentUserId);
      setSelectedGroupIds([createdGroup.id]);
      setShowCreateGroupForm(false);
      setNewGroupName("");
      setNewGroupSelectedNodeIds([]);
      setCreateGroupError(null);
      setIsSaving(false);
      return;
    }

    if (persistenceFailed) {
      setGroupError(`${persistenceFailed} Using browser-local group storage for now.`);
    }

    const localGroup: Group = {
      id: `local-group:${crypto.randomUUID()}`,
      name,
      color: GROUP_COLORS[groups.length % GROUP_COLORS.length],
    };

    const nextGroups = [...groups, localGroup];
    const nextNodeGroupIdsByNodeId: Record<string, string[]> = {
      ...nodeGroupIdsByNodeId,
    };

    for (const nodeId of newGroupSelectedNodeIds) {
      const existing = nextNodeGroupIdsByNodeId[nodeId] ?? [];
      nextNodeGroupIdsByNodeId[nodeId] = existing.includes(localGroup.id)
        ? existing
        : [...existing, localGroup.id];
    }

    setGroups(nextGroups);
    setNodeGroupIdsByNodeId(nextNodeGroupIdsByNodeId);
    saveGroupsToLocalStorage(nextGroups, nextNodeGroupIdsByNodeId);
    if (!groupTable || !groupMembershipTable) {
      setGroupError("Create groups and group_memberships tables in Supabase to persist groups across devices.");
    }
    setSelectedGroupIds([localGroup.id]);
    setShowCreateGroupForm(false);
    setNewGroupName("");
    setNewGroupSelectedNodeIds([]);
    setCreateGroupError(null);
    setIsSaving(false);
  };

  const handleEditGroup = async () => {
    if (!currentUserId) {
      setCreateGroupError("You must be signed in before editing a group.");
      return;
    }

    const editingGroupId = selectedGroupIds.length === 1 ? selectedGroupIds[0] : "";

    if (!editingGroupId) {
      setCreateGroupError("Choose a group to edit.");
      return;
    }

    const existingGroup = groups.find((group) => group.id === editingGroupId);
    if (!existingGroup) {
      setCreateGroupError("Unable to find the selected group.");
      return;
    }

    const nextName = newGroupName.trim();
    if (!nextName) {
      setCreateGroupError("Enter a group name.");
      return;
    }

    if (
      groups.some(
        (group) =>
          group.id !== editingGroupId &&
          normalizeGroupName(group.name) === normalizeGroupName(nextName)
      )
    ) {
      setCreateGroupError("A group with this name already exists.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setGroupError(null);
    setCreateGroupError(null);

    let persistenceFailed: string | null = null;

    if (groupTable && groupMembershipTable) {
      const updateResult = await supabase.from(groupTable).update({ name: nextName }).eq("id", editingGroupId);

      if (updateResult.error && hasMissingColumnError(updateResult.error.message, "name")) {
        persistenceFailed = updateResult.error.message;
      } else if (updateResult.error) {
        persistenceFailed = updateResult.error.message;
      }

      if (!persistenceFailed) {
        let deleteResult = await supabase
          .from(groupMembershipTable)
          .delete()
          .eq("group_id", editingGroupId);

        if (deleteResult.error && hasMissingColumnError(deleteResult.error.message, "group_id")) {
          deleteResult = await supabase
            .from(groupMembershipTable)
            .delete()
            .eq("groupId", editingGroupId);
        }

        if (deleteResult.error) {
          persistenceFailed = deleteResult.error.message;
        }
      }

      if (!persistenceFailed) {
        for (const nodeId of newGroupSelectedNodeIds) {
          const membershipPayloads = [
            { node_id: nodeId, group_id: editingGroupId, user_id: currentUserId },
            { node_id: nodeId, group_id: editingGroupId },
            { nodeId, groupId: editingGroupId, user_id: currentUserId },
            { nodeId, groupId: editingGroupId },
          ];

          let inserted = false;

          for (const payload of membershipPayloads) {
            const insertResult = await supabase.from(groupMembershipTable).insert(payload);

            if (insertResult.error) {
              if (
                hasMissingColumnError(insertResult.error.message, "node_id") ||
                hasMissingColumnError(insertResult.error.message, "group_id") ||
                hasMissingColumnError(insertResult.error.message, "nodeId") ||
                hasMissingColumnError(insertResult.error.message, "groupId") ||
                hasMissingColumnError(insertResult.error.message, "user_id")
              ) {
                continue;
              }

              persistenceFailed = insertResult.error.message;
              break;
            }

            inserted = true;
            break;
          }

          if (!inserted) {
            if (!persistenceFailed) {
              persistenceFailed = "Unable to update group memberships.";
            }
            break;
          }
        }
      }
    }

    if (!persistenceFailed && groupTable && groupMembershipTable) {
      await fetchGraphData(currentUserId);
      setShowEditGroupForm(false);
      setCreateGroupError(null);
      setIsSaving(false);
      return;
    }

    if (persistenceFailed) {
      setGroupError(`${persistenceFailed} Using browser-local group storage for now.`);
    }

    const nextGroups = groups.map((group) =>
      group.id === editingGroupId
        ? {
            ...group,
            name: nextName,
          }
        : group
    );

    const nextNodeGroupIdsByNodeId: Record<string, string[]> = {};

    for (const node of graphData.nodes) {
      const existingMemberships = nodeGroupIdsByNodeId[node.id] ?? [];
      nextNodeGroupIdsByNodeId[node.id] = existingMemberships.filter((groupId) => groupId !== editingGroupId);
    }

    for (const nodeId of newGroupSelectedNodeIds) {
      const existingMemberships = nextNodeGroupIdsByNodeId[nodeId] ?? [];
      nextNodeGroupIdsByNodeId[nodeId] = existingMemberships.includes(editingGroupId)
        ? existingMemberships
        : [...existingMemberships, editingGroupId];
    }

    setGroups(nextGroups);
    setNodeGroupIdsByNodeId(nextNodeGroupIdsByNodeId);
    saveGroupsToLocalStorage(nextGroups, nextNodeGroupIdsByNodeId);
    setShowEditGroupForm(false);
    setCreateGroupError(null);
    setIsSaving(false);
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

  const editNodeGroups = async (node: { id: string; name: string }) => {
    if (!currentUserId) {
      setError("You must be signed in before editing groups.");
      return;
    }

    const currentGroupNames = (nodeGroupIdsByNodeId[node.id] ?? [])
      .map((groupId) => groupById.get(groupId)?.name)
      .filter((name): name is string => Boolean(name));

    const nextInput = window.prompt(
      "Enter comma-separated groups (example: book club, neighbors):",
      currentGroupNames.join(", ")
    );

    if (nextInput === null) {
      return;
    }

    const nextNames = Array.from(
      new Map(
        nextInput
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
          .map((name) => [normalizeGroupName(name), name])
      ).values()
    );

    const sameMemberships =
      nextNames.length === currentGroupNames.length &&
      nextNames.every((name) =>
        currentGroupNames.some((currentName) => normalizeGroupName(currentName) === normalizeGroupName(name))
      );

    if (sameMemberships) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setGroupError(null);

    const groupsByNormalizedName = new Map(groups.map((group) => [normalizeGroupName(group.name), group]));
    const missingNames = nextNames.filter((name) => !groupsByNormalizedName.has(normalizeGroupName(name)));

    let nextGroups = [...groups];
    const nextNodeGroupIdsByNodeId: Record<string, string[]> = {
      ...nodeGroupIdsByNodeId,
    };

    if (groupTable && groupMembershipTable) {
      let persistenceFailed: string | null = null;

      for (let index = 0; index < missingNames.length; index += 1) {
        const name = missingNames[index];
        const color = GROUP_COLORS[(groups.length + index) % GROUP_COLORS.length];
        const payloads = [
          { name, color, user_id: currentUserId },
          { name, user_id: currentUserId },
          { name, color },
          { name },
        ];

        let createdGroup: Group | null = null;

        for (const payload of payloads) {
          const insertResult = await supabase.from(groupTable).insert(payload).select("*").single();

          if (insertResult.error) {
            if (
              hasMissingColumnError(insertResult.error.message, "color") ||
              hasMissingColumnError(insertResult.error.message, "user_id")
            ) {
              continue;
            }

            persistenceFailed = insertResult.error.message;
            break;
          }

          const row = insertResult.data as GroupRecord;
          if (typeof row.id !== "string" || typeof row.name !== "string") {
            persistenceFailed = "Unable to read created group.";
            break;
          }

          createdGroup = {
            id: row.id,
            name: row.name,
            color: typeof row.color === "string" && row.color ? row.color : color,
          };
          break;
        }

        if (createdGroup) {
          nextGroups = [...nextGroups, createdGroup];
          groupsByNormalizedName.set(normalizeGroupName(createdGroup.name), createdGroup);
          continue;
        }

        if (!persistenceFailed) {
          persistenceFailed = `Unable to create group \"${name}\".`;
        }
        break;
      }

      if (!persistenceFailed) {
        let deleteResult = await supabase.from(groupMembershipTable).delete().eq("node_id", node.id);

        if (deleteResult.error && hasMissingColumnError(deleteResult.error.message, "node_id")) {
          deleteResult = await supabase.from(groupMembershipTable).delete().eq("nodeId", node.id);
        }

        if (deleteResult.error) {
          persistenceFailed = deleteResult.error.message;
        }
      }

      if (!persistenceFailed) {
        const targetGroupIds = nextNames
          .map((name) => groupsByNormalizedName.get(normalizeGroupName(name))?.id)
          .filter((groupId): groupId is string => Boolean(groupId));

        for (const groupId of targetGroupIds) {
          const payloads = [
            { node_id: node.id, group_id: groupId, user_id: currentUserId },
            { node_id: node.id, group_id: groupId },
            { nodeId: node.id, groupId: groupId, user_id: currentUserId },
            { nodeId: node.id, groupId: groupId },
          ];

          let inserted = false;

          for (const payload of payloads) {
            const insertResult = await supabase.from(groupMembershipTable).insert(payload);

            if (insertResult.error) {
              if (
                hasMissingColumnError(insertResult.error.message, "node_id") ||
                hasMissingColumnError(insertResult.error.message, "group_id") ||
                hasMissingColumnError(insertResult.error.message, "nodeId") ||
                hasMissingColumnError(insertResult.error.message, "groupId") ||
                hasMissingColumnError(insertResult.error.message, "user_id")
              ) {
                continue;
              }

              persistenceFailed = insertResult.error.message;
              break;
            }

            inserted = true;
            break;
          }

          if (!inserted) {
            if (!persistenceFailed) {
              persistenceFailed = "Unable to save group memberships.";
            }
            break;
          }
        }
      }

      if (!persistenceFailed) {
        await fetchGraphData(currentUserId);
        setIsSaving(false);
        return;
      }

      setGroupError(`${persistenceFailed} Using browser-local group storage for now.`);
    }

    const missingLocalGroups = missingNames.map((name, index) => ({
      id: `local-group:${crypto.randomUUID()}`,
      name,
      color: GROUP_COLORS[(groups.length + index) % GROUP_COLORS.length],
    }));
    nextGroups = [...nextGroups, ...missingLocalGroups];

    const nextGroupsByNormalizedName = new Map(
      nextGroups.map((group) => [normalizeGroupName(group.name), group])
    );
    nextNodeGroupIdsByNodeId[node.id] = nextNames
      .map((name) => nextGroupsByNormalizedName.get(normalizeGroupName(name))?.id)
      .filter((groupId): groupId is string => Boolean(groupId));

    setGroups(nextGroups);
    setNodeGroupIdsByNodeId(nextNodeGroupIdsByNodeId);
    saveGroupsToLocalStorage(nextGroups, nextNodeGroupIdsByNodeId);
    if (!groupTable || !groupMembershipTable) {
      setGroupError("Create groups and group_memberships tables in Supabase to persist groups across devices.");
    }
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

    if (target.kind === "group") {
      setError("Delete group is not available yet. Right-click the group to edit it.");
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

    if (target.kind === "group") {
      handleOpenEditGroupForm(target.group.id);
      return;
    }

    await editConnectionType(target.link);
  };

  const handleContextMenuEditGroups = async () => {
    if (!contextMenu || contextMenu.target.kind !== "node") {
      return;
    }

    const targetNode = contextMenu.target.node;
    setContextMenu(null);
    await editNodeGroups(targetNode);
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

  const renderMessageText = (rawText: string) => {
    const text = rawText.replace(/\\n/g, "\n");

    return text.split("\n").map((line, lineIndex) => {
      const parts: Array<string | ReactNode> = [];
      const boldPattern = /\*\*(.+?)\*\*/g;
      let lastIndex = 0;
      let match = boldPattern.exec(line);

      while (match) {
        const matchText = match[1] ?? "";
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;

        if (matchStart > lastIndex) {
          parts.push(line.slice(lastIndex, matchStart));
        }

        parts.push(
          <strong key={`bold-${lineIndex}-${matchStart}`} className="font-semibold">
            {matchText}
          </strong>
        );

        lastIndex = matchEnd;
        match = boldPattern.exec(line);
      }

      if (lastIndex < line.length) {
        parts.push(line.slice(lastIndex));
      }

      return (
        <span key={`line-${lineIndex}`}>
          {parts.length > 0 ? parts : line}
          {lineIndex < text.split("\n").length - 1 ? <br /> : null}
        </span>
      );
    });
  };

  const parseEventIntent = (question: string) => {
    const normalized = question.replace(/\s+/g, " ").trim();
    const lower = normalized.toLowerCase();

    const eventIntentMarkers = [
      "show me",
      "create",
      "make",
      "plan",
      "event",
      "party",
      "dinner",
      "trip",
      "going on",
      "so far",
    ];
    const hasIntentMarker = eventIntentMarkers.some((marker) => lower.includes(marker));
    if (!hasIntentMarker) {
      return null;
    }

    let eventNamePart = "";
    let attendeePart = "";

    const soFarMatch = normalized.match(
      /^(.*?)(?:,?\s*)(?:so far|currently|as of now)\s+(.+?)\s+(?:is|are)\s+(?:going|coming|attending|joining)/i
    );
    if (soFarMatch) {
      eventNamePart = soFarMatch[1]?.trim() ?? "";
      attendeePart = soFarMatch[2]?.trim() ?? "";
    } else {
      const withIndex = lower.lastIndexOf(" with ");
      if (withIndex === -1) {
        return null;
      }

      eventNamePart = normalized.slice(0, withIndex).trim();
      const attendeePartRaw = normalized.slice(withIndex + 6).trim();
      attendeePart = attendeePartRaw.split(/[.?!]/)[0]?.trim() ?? "";
    }

    eventNamePart = eventNamePart
      .replace(/^show me( what)?( a| an)?\s+/i, "")
      .replace(/^create( me)?( a| an)?\s+/i, "")
      .replace(/^make( me)?( a| an)?\s+/i, "")
      .replace(/^plan( me)?( a| an)?\s+/i, "")
      .replace(/^i am going on( a| an)?\s+/i, "")
      .replace(/^i'?m going on( a| an)?\s+/i, "")
      .replace(/^we are going on( a| an)?\s+/i, "")
      .replace(/^we'?re going on( a| an)?\s+/i, "")
      .replace(/^i am planning( a| an)?\s+/i, "")
      .replace(/^i'?m planning( a| an)?\s+/i, "")
      .replace(/^we are planning( a| an)?\s+/i, "")
      .replace(/^we'?re planning( a| an)?\s+/i, "")
      .replace(/[\s,]+and$/i, "")
      .replace(/\s+(would look like|looks like|look like)$/i, "")
      .replace(/\s+event$/i, "")
      .replace(/[,:;.!?]+$/g, "")
      .trim();

    const eventName = eventNamePart || "New Event";

    const cleanedAttendeePart = attendeePart
      .replace(/^(?:i|we)\s+know\s+that\s+/i, "")
      .replace(/^(?:i|we)\s+know\s+/i, "")
      .replace(/^(?:i\s+know\s+that\s+)?(?:so far\s+)?(?:it(?:'s| is)\s+)?(?:just\s+)?/i, "")
      .replace(/^(?:there(?:'s| are)\s+)?(?:currently\s+)?/i, "")
      .replace(/^(?:the\s+people\s+going\s+are\s+|the\s+people\s+coming\s+are\s+)/i, "")
      .replace(/\s+(?:is|are)\s+(?:going|coming|attending|joining)\b.*$/i, "")
      .trim();

    const attendeeNames = cleanedAttendeePart
      .replace(/[.?!]$/g, "")
      .split(/,|\band\b/i)
      .map((name) => name.trim().replace(/^and\s+/i, ""))
      .map((name) => name.replace(/^['\"]|['\"]$/g, ""))
      .filter(Boolean);

    if (attendeeNames.length === 0) {
      return null;
    }

    return { eventName, attendeeNames };
  };

  const isLikelyEventIntentQuestion = (question: string) => {
    const lower = question.replace(/\s+/g, " ").trim().toLowerCase();
    const markers = [
      "show me",
      "create",
      "make",
      "plan",
      "event",
      "party",
      "dinner",
      "trip",
      "going",
      "coming",
      "attending",
      "joining",
    ];

    return markers.some((marker) => lower.includes(marker));
  };

  const extractEventIntentWithAgent = async (question: string) => {
    try {
      const response = await fetch("/api/social-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "extract-event-intent",
          question,
          graphData,
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as {
        eventIntent?: {
          eventName?: string;
          attendeeNames?: string[];
        } | null;
      };

      const eventName = data.eventIntent?.eventName?.trim() ?? "";
      const attendeeNames = (data.eventIntent?.attendeeNames ?? [])
        .map((name) => name.trim())
        .filter(Boolean)
        .filter(
          (name, index, names) =>
            names.findIndex((candidate) => normalizePersonName(candidate) === normalizePersonName(name)) ===
            index
        );

      if (!eventName || attendeeNames.length === 0) {
        return null;
      }

      return { eventName, attendeeNames };
    } catch {
      return null;
    }
  };

  const createEventFromPromptIntent = async (eventName: string, attendeeNames: string[]) => {
    if (!currentUserId) {
      return "Sign in first, then I can create events for you.";
    }

    const attendees: EventAttendee[] = attendeeNames.reduce<EventAttendee[]>((acc, rawName) => {
      const name = rawName.trim();
      if (!name) {
        return acc;
      }

      const matchingNode = graphData.nodes.find(
        (node) => normalizePersonName(node.name) === normalizePersonName(name)
      );

      const duplicate = acc.some((attendee) => {
        if (attendee.existingNodeId && matchingNode) {
          return attendee.existingNodeId === matchingNode.id;
        }

        return normalizePersonName(attendee.name) === normalizePersonName(name);
      });

      if (duplicate) {
        return acc;
      }

      if (matchingNode) {
        acc.push({
          id: `existing:${matchingNode.id}`,
          name: matchingNode.name,
          existingNodeId: matchingNode.id,
        });
      } else {
        acc.push({
          id: `custom:${crypto.randomUUID()}`,
          name,
        });
      }

      return acc;
    }, []);

    if (attendees.length === 0) {
      return "I couldn't identify any attendee names to add.";
    }

    const event: PlannedEvent = {
      id: crypto.randomUUID(),
      name: eventName,
      attendees,
      createdAt: new Date().toISOString(),
    };

    setIsLoadingEvents(true);
    let savedRemotely = false;

    for (const table of EVENT_TABLE_CANDIDATES) {
      const insertResult = await supabase.from(table).insert({
        id: event.id,
        user_id: currentUserId,
        name: event.name,
        attendees: event.attendees,
        created_at: event.createdAt,
      });

      if (insertResult.error) {
        if (hasMissingTableError(insertResult.error.message, table)) {
          continue;
        }

        if (hasMissingColumnError(insertResult.error.message, "attendees")) {
          const retryResult = await supabase.from(table).insert({
            id: event.id,
            user_id: currentUserId,
            name: event.name,
            created_at: event.createdAt,
          });

          if (retryResult.error) {
            setIsLoadingEvents(false);
            return `I couldn't create that event: ${retryResult.error.message}`;
          }

          savedRemotely = true;
          break;
        }

        setIsLoadingEvents(false);
        return `I couldn't create that event: ${insertResult.error.message}`;
      }

      savedRemotely = true;
      break;
    }

    if (!savedRemotely) {
      const nextEvents = [event, ...plannedEvents];
      savePlannedEventsToLocalStorage(nextEvents);
      setPlannedEvents(nextEvents);
      setSelectedEventId(event.id);
      setSidebarTab("events");
      setEditingEventId(null);
      setEventError(
        "Created locally in this browser. Create a planned_events table in Supabase to sync events across devices."
      );
      setIsLoadingEvents(false);

      return `Created event \"${event.name}\" with ${attendees.length} attendee${attendees.length === 1 ? "" : "s"}, and switched to Events view.`;
    }

    await loadPlannedEvents();
    setSelectedEventId(event.id);
    setSidebarTab("events");
    setEditingEventId(null);
    setEventError(null);
    setIsLoadingEvents(false);

    return `Created event \"${event.name}\" with ${attendees.length} attendee${attendees.length === 1 ? "" : "s"}, and switched to Events view.`;
  };

  const handleAddPendingEventAttendee = (attendeeNameInput?: string) => {
    const attendeeName = (attendeeNameInput ?? pendingEventAttendeeQuery).trim();
    if (!attendeeName) {
      setPendingEventConfirmationError("Enter a name to add as an attendee.");
      return;
    }

    const alreadyAdded = pendingEventDraftAttendees.some(
      (existingName) => normalizePersonName(existingName) === normalizePersonName(attendeeName)
    );

    if (alreadyAdded) {
      setPendingEventAttendeeQuery("");
      return;
    }

    setPendingEventDraftAttendees((current) => [...current, attendeeName]);
    setPendingEventAttendeeQuery("");
    setPendingEventConfirmationError(null);
  };

  const handleRemovePendingEventAttendee = (attendeeName: string) => {
    setPendingEventDraftAttendees((current) =>
      current.filter((existingName) => normalizePersonName(existingName) !== normalizePersonName(attendeeName))
    );
    setPendingEventConfirmationError(null);
  };

  const getAdditionalSuggestionBounds = (sourceQuestion: string, currentAttendeeCount: number) => {
    const normalized = sourceQuestion.replace(/[–—]/g, "-");
    const rangeMatch = normalized.match(
      /(\d+)\s*(?:-|to)\s*(\d+)\s*(?:people|person|attendees|guests)\b/i
    );

    if (rangeMatch) {
      const minTotal = Number(rangeMatch[1]);
      const maxTotal = Number(rangeMatch[2]);

      if (Number.isFinite(minTotal) && Number.isFinite(maxTotal) && maxTotal >= minTotal) {
        const minAdditional = Math.max(1, minTotal - currentAttendeeCount);
        const maxAdditional = Math.max(minAdditional, maxTotal - currentAttendeeCount);
        return {
          minAdditional,
          maxAdditional: Math.min(5, maxAdditional),
        };
      }
    }

    const singleMatch = normalized.match(/(\d+)\s*(?:people|person|attendees|guests)\b/i);
    if (singleMatch) {
      const targetTotal = Number(singleMatch[1]);
      if (Number.isFinite(targetTotal) && targetTotal > 0) {
        const additional = Math.max(1, targetTotal - currentAttendeeCount);
        return {
          minAdditional: Math.min(5, additional),
          maxAdditional: Math.min(5, additional),
        };
      }
    }

    return null;
  };

  const suggestAdditionalAttendees = async (
    eventName: string,
    attendeeNames: string[],
    sourceQuestion?: string
  ) => {
    const normalizedCurrentNames = new Set(attendeeNames.map((name) => normalizePersonName(name)));
    const suggestionBounds = sourceQuestion
      ? getAdditionalSuggestionBounds(sourceQuestion, attendeeNames.length)
      : null;
    const requestedCountInstruction = suggestionBounds
      ? suggestionBounds.minAdditional === suggestionBounds.maxAdditional
        ? `Suggest exactly ${suggestionBounds.maxAdditional} names`
        : `Suggest ${suggestionBounds.minAdditional}-${suggestionBounds.maxAdditional} names`
      : "Suggest up to 5 names";

    try {
      const response = await fetch("/api/social-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question:
            (sourceQuestion
              ? `Original user question: "${sourceQuestion}". `
              : "") +
            `I am planning an event called "${eventName}" with these attendees: ${attendeeNames.join(", ")}. ` +
            "Who else could I add to increase social connection? " +
            `${requestedCountInstruction} from the existing graph only, excluding current attendees. ` +
            "Use short bullet points with a one-line reason each.",
          graphData,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { answer?: string };
        const answer = data.answer?.trim();
        if (answer) {
          return answer;
        }
      }
    } catch {
      // Fall back to local heuristic below
    }

    const nodeById = new Map(graphData.nodes.map((node) => [node.id, node]));
    const selectedIds = new Set(
      graphData.nodes
        .filter((node) => normalizedCurrentNames.has(normalizePersonName(node.name)))
        .map((node) => node.id)
    );

    const scores = new Map<string, { positive: number; negative: number }>();

    for (const link of graphData.links) {
      const source = getLinkEndpointId((link as { source?: unknown }).source);
      const target = getLinkEndpointId((link as { target?: unknown }).target);
      if (!source || !target) {
        continue;
      }

      const type = String(link.type ?? "friends").toLowerCase();
      const sourceSelected = selectedIds.has(source);
      const targetSelected = selectedIds.has(target);
      if (sourceSelected === targetSelected) {
        continue;
      }

      const candidateId = sourceSelected ? target : source;
      const candidateName = nodeById.get(candidateId)?.name;
      if (!candidateName || normalizedCurrentNames.has(normalizePersonName(candidateName))) {
        continue;
      }

      const current = scores.get(candidateId) ?? { positive: 0, negative: 0 };
      if (type === "friends" || type === "coworkers" || type === "family" || type === "lovers") {
        current.positive += 1;
      }
      if (type === "enemies") {
        current.negative += 1;
      }
      scores.set(candidateId, current);
    }

    const ranked = [...scores.entries()]
      .map(([id, score]) => ({
        id,
        name: nodeById.get(id)?.name ?? id,
        score: score.positive - score.negative * 2,
        positive: score.positive,
        negative: score.negative,
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, suggestionBounds?.maxAdditional ?? 5);

    if (ranked.length === 0) {
      return "I couldn't find strong additional candidates from the current graph without introducing likely conflicts.";
    }

    return [
      "Suggested additions (local fallback):",
      ...ranked.map(
        (entry) =>
          `- ${entry.name} (connections: +${entry.positive}, conflicts: ${entry.negative})`
      ),
    ].join("\n");
  };

  const handleConfirmAgentEventCreation = async () => {
    if (!pendingEventConfirmation) {
      return;
    }

    const eventName = pendingEventDraftName.trim();
    const attendeeNames = pendingEventDraftAttendees.map((name) => name.trim()).filter(Boolean);

    if (!eventName) {
      setPendingEventConfirmationError("Give the event a name.");
      return;
    }

    if (attendeeNames.length === 0) {
      setPendingEventConfirmationError("Add at least one attendee.");
      return;
    }

    const { shouldSuggestMore, sourceQuestion } = pendingEventConfirmation;
    setPendingEventConfirmation(null);
    setPendingEventDraftName("");
    setPendingEventDraftAttendees([]);
    setPendingEventAttendeeQuery("");
    setPendingEventConfirmationError(null);

    const intentResult = await createEventFromPromptIntent(eventName, attendeeNames);
    setAgentMessages((current) => [...current, { role: "assistant", text: intentResult }]);

    if (shouldSuggestMore && intentResult.toLowerCase().startsWith("created event")) {
      const suggestions = await suggestAdditionalAttendees(eventName, attendeeNames, sourceQuestion);
      setAgentMessages((current) => [...current, { role: "assistant", text: suggestions }]);
    }
  };

  const handleCancelAgentEventCreation = () => {
    if (!pendingEventConfirmation) {
      return;
    }

    const { eventName } = pendingEventConfirmation;
    setPendingEventConfirmation(null);
    setPendingEventDraftName("");
    setPendingEventDraftAttendees([]);
    setPendingEventAttendeeQuery("");
    setPendingEventConfirmationError(null);
    setAgentMessages((current) => [
      ...current,
      {
        role: "assistant",
        text: `Cancelled. I did not create the event \"${eventName}\".`,
      },
    ]);
  };

  const handleAskAgent = async (overrideQuestion?: string) => {
    const question = (overrideQuestion ?? agentQuestion).trim();
    if (!question) {
      return;
    }

    setIsAgentLoading(true);
    setAgentError(null);
    setAgentMessages((current) => [
      ...current,
      { role: "user", text: question },
    ]);
    if (!overrideQuestion) {
      setAgentQuestion("");
    }

    let eventIntent = null as ReturnType<typeof parseEventIntent>;

    if (isLikelyEventIntentQuestion(question)) {
      eventIntent = await extractEventIntentWithAgent(question);
    }

    if (!eventIntent) {
      eventIntent = parseEventIntent(question);
    }

    if (eventIntent) {
      const shouldSuggestMore =
        /who else|anyone else|who should .*add|could i add|what else should|who else should go|who should go|who else should come|who should come/i.test(
          question
        );

      setPendingEventConfirmation({
        eventName: eventIntent.eventName,
        attendeeNames: eventIntent.attendeeNames,
        sourceQuestion: question,
        shouldSuggestMore,
      });
      setPendingEventDraftName(eventIntent.eventName);
      setPendingEventDraftAttendees(eventIntent.attendeeNames);
      setPendingEventAttendeeQuery("");
      setPendingEventConfirmationError(null);

      setAgentMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: `I can create event \"${eventIntent.eventName}\" with ${eventIntent.attendeeNames.join(
            ", "
          )}. Please confirm in the popup window.`,
        },
      ]);
      setIsAgentLoading(false);
      if (overrideQuestion) {
        setAgentQuestion("");
      }
      return;
    }

    try {
      const recentHistory = [...agentMessages, { role: "user", text: question }].slice(-10);

      setAgentMessages((current) => [...current, { role: "assistant", text: "" }]);

      const response = await fetch("/api/social-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "chat",
          stream: true,
          question,
          graphData,
          messageHistory: recentHistory,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Server agent unavailable");
      }

      if (!response.body) {
        throw new Error("No response stream available.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        answer += decoder.decode(value, { stream: true });
        const streamedText = answer;
        setAgentMessages((current) => {
          const updated = [...current];
          for (let index = updated.length - 1; index >= 0; index -= 1) {
            if (updated[index]?.role === "assistant") {
              updated[index] = {
                ...updated[index],
                text: streamedText,
              };
              break;
            }
          }
          return updated;
        });
      }

      answer += decoder.decode();
      const finalAnswer = answer.trim();
      if (!finalAnswer) {
        throw new Error("Empty answer");
      }

      setAgentMessages((current) => {
        const updated = [...current];
        for (let index = updated.length - 1; index >= 0; index -= 1) {
          if (updated[index]?.role === "assistant") {
            updated[index] = {
              ...updated[index],
              text: finalAnswer,
            };
            break;
          }
        }
        return updated;
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Backend agent failed. Check that the dev server was restarted after editing .env.local and that GEMINI_API_KEY is valid.";
      setAgentError(errorMessage);
      setAgentMessages((current) => {
        const updated = [...current];
        const lastMessage = updated[updated.length - 1];
        if (lastMessage?.role === "assistant" && !lastMessage.text.trim()) {
          updated.pop();
        }
        return updated;
      });
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
      if (overrideQuestion) {
        setAgentQuestion("");
      }
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

    const visible = groupFilteredGraphData;
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
        await fetchGraphData(userId);
      })();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [fetchGraphData, getCurrentUserId]);

  useEffect(() => {
    setSelectedGroupIds((current) => current.filter((groupId) => groups.some((group) => group.id === groupId)));
  }, [groups]);

  useEffect(() => {
    if (!currentUserId) {
      setIsApprover(false);
      return;
    }

    void loadApproverStatus();
  }, [currentUserId, loadApproverStatus]);

  useEffect(() => {
    if (!currentUserId) {
      setPendingRequests([]);
      setPlannedEvents([]);
      return;
    }

    if (!isApprover) {
      setPendingRequests([]);
      return;
    }

    void loadPendingRequests();
  }, [currentUserId, isApprover, loadPendingRequests]);

  useEffect(() => {
    if (!currentUserId) {
      setPlannedEvents([]);
      return;
    }

    void loadPlannedEvents();
  }, [currentUserId, loadPlannedEvents]);

  useEffect(() => {
    if (!currentUserId || !isApprover) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadPendingRequests();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentUserId, isApprover, loadPendingRequests]);

  useEffect(() => {
    if (!selectedEventId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      graphRef.current?.d3ReheatSimulation?.();
      graphRef.current?.zoomToFit?.(600, 80);
    }, 120);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [selectedEventId, activeGraphData]);

  useEffect(() => {
    const updateRightPanelTop = () => {
      const headerBottom = topHeaderRef.current?.getBoundingClientRect().bottom;
      if (typeof headerBottom === "number") {
        setRightPanelTop(Math.max(0, Math.round(headerBottom)));
      }
    };

    updateRightPanelTop();

    const headerElement = topHeaderRef.current;
    let resizeObserver: ResizeObserver | null = null;

    if (headerElement && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        updateRightPanelTop();
      });
      resizeObserver.observe(headerElement);
    }

    window.addEventListener("resize", updateRightPanelTop);

    return () => {
      window.removeEventListener("resize", updateRightPanelTop);
      resizeObserver?.disconnect();
    };
  }, []);

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
      <header ref={topHeaderRef} className="p-4 bg-white shadow-md z-10 flex justify-between items-center">
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
              id="include-coworkers"
              type="checkbox"
              checked={includeCoworkers}
              onChange={(event) => setIncludeCoworkers(event.target.checked)}
              className="h-4 w-4"
            />
            Include coworkers
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

      {showCreateGroupForm ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/35 p-4">
          <section className="w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-800">Create Group</h3>
              <button
                type="button"
                onClick={() => {
                  setShowCreateGroupForm(false);
                  setCreateGroupError(null);
                }}
                className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 p-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Group name</label>
                <input
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  placeholder="coffee"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">People</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setNewGroupSelectedNodeIds(alphabetizedGroupNodes.map((node) => node.id))
                    }
                    className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewGroupSelectedNodeIds([])}
                    className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="max-h-64 space-y-2 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-3">
                {alphabetizedGroupNodes.length === 0 ? (
                  <p className="text-sm text-slate-500">No people available yet.</p>
                ) : (
                  alphabetizedGroupNodes.map((node) => (
                    <label key={node.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={newGroupSelectedNodeIds.includes(node.id)}
                        onChange={() => handleToggleCreateGroupNode(node.id)}
                        className="h-4 w-4"
                      />
                      {node.name}
                    </label>
                  ))
                )}
              </div>

              {createGroupError ? <p className="text-sm text-red-600">{createGroupError}</p> : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setShowCreateGroupForm(false);
                  setCreateGroupError(null);
                }}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleCreateGroup();
                }}
                disabled={isSaving}
                className="px-4 py-2 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSaving ? "Saving..." : "Create Group"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {showEditGroupForm ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/35 p-4">
          <section className="w-full max-w-xl rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-800">Edit Group</h3>
              <button
                type="button"
                onClick={() => {
                  setShowEditGroupForm(false);
                  setCreateGroupError(null);
                }}
                className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 p-4">
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Group name</label>
                <input
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  placeholder="coffee"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">People</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setNewGroupSelectedNodeIds(alphabetizedGroupNodes.map((node) => node.id))
                    }
                    className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewGroupSelectedNodeIds([])}
                    className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="max-h-64 space-y-2 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-3">
                {alphabetizedGroupNodes.length === 0 ? (
                  <p className="text-sm text-slate-500">No people available yet.</p>
                ) : (
                  alphabetizedGroupNodes.map((node) => (
                    <label key={node.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={newGroupSelectedNodeIds.includes(node.id)}
                        onChange={() => handleToggleCreateGroupNode(node.id)}
                        className="h-4 w-4"
                      />
                      {node.name}
                    </label>
                  ))
                )}
              </div>

              {createGroupError ? <p className="text-sm text-red-600">{createGroupError}</p> : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => {
                  setShowEditGroupForm(false);
                  setCreateGroupError(null);
                }}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleEditGroup();
                }}
                disabled={isSaving}
                className="px-4 py-2 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSaving ? "Saving..." : "Save Group"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {!currentUserId && showAccountRequestForm ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/35 p-4">
          <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-800">Create Account Request</h3>
              <button
                type="button"
                onClick={() => setShowAccountRequestForm(false)}
                className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 p-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-slate-700">First Name</label>
                <input
                  value={requestFirstName}
                  onChange={(event) => setRequestFirstName(event.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded"
                  placeholder="First name"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm text-slate-700">Last Name</label>
                <input
                  value={requestLastName}
                  onChange={(event) => setRequestLastName(event.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded"
                  placeholder="Last name"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm text-slate-700">Email</label>
                <input
                  type="email"
                  value={requestEmail}
                  onChange={(event) => setRequestEmail(event.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded"
                  placeholder="name@example.com"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowAccountRequestForm(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
              >
                Cancel
              </button>
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
        </div>
      ) : null}

      {pendingEventConfirmation ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4">
          <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-800">Confirm Event Creation</h3>
              <p className="text-sm text-slate-600">
                The app parsed this from your prompt. Edit anything before creating.
              </p>
            </div>

            <div className="space-y-3 p-4">
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">Event Name</label>
                <input
                  value={pendingEventDraftName}
                  onChange={(event) => {
                    setPendingEventDraftName(event.target.value);
                    if (pendingEventConfirmationError) {
                      setPendingEventConfirmationError(null);
                    }
                  }}
                  placeholder="Event name"
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Attendees</p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    list="pending-event-attendee-options"
                    value={pendingEventAttendeeQuery}
                    onChange={(event) => setPendingEventAttendeeQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleAddPendingEventAttendee();
                      }
                    }}
                    placeholder="Add attendee"
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddPendingEventAttendee()}
                    className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-700 hover:bg-slate-200"
                  >
                    Add
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {pendingEventDraftAttendees.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => handleRemovePendingEventAttendee(name)}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                      title="Remove attendee"
                    >
                      {name}
                      <span aria-hidden>×</span>
                    </button>
                  ))}
                </div>
                <datalist id="pending-event-attendee-options">
                  {graphData.nodes.map((node) => (
                    <option key={`pending-event-node-${node.id}`} value={node.name} />
                  ))}
                </datalist>
              </div>

              {pendingEventConfirmationError ? (
                <p className="text-sm text-red-600">{pendingEventConfirmationError}</p>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={handleCancelAgentEventCreation}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleConfirmAgentEventCreation();
                }}
                disabled={isLoadingEvents}
                className="px-4 py-2 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoadingEvents ? "Creating..." : "Create Event"}
              </button>
            </div>
          </section>
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
      <div className={`flex-grow overflow-hidden flex ${currentUserId ? "pr-96" : ""}`}>
        <div ref={graphAreaRef} className="flex-1 overflow-hidden relative">
          {currentUserId ? (
            <section className="fixed bottom-4 left-4 z-20 w-[22rem] rounded-lg border border-slate-200 bg-white/95 p-3 shadow-md backdrop-blur-sm">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  Group view
                  <select
                    value={groupViewMode}
                    onChange={(event) => setGroupViewMode(event.target.value as "all" | "highlight" | "only")}
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="all">All</option>
                    <option value="highlight">Highlight selected</option>
                    <option value="only">Only selected</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={handleOpenCreateGroupForm}
                  disabled={!currentUserId || isSaving}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  title="Add group"
                >
                  <span aria-hidden>+</span>
                </button>
              </div>

              <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto pr-1">
                {groupCounts.map(({ group, count }) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() =>
                      setSelectedGroupIds((current) =>
                        current.includes(group.id)
                          ? current.filter((groupId) => groupId !== group.id)
                          : [...current, group.id]
                      )
                    }
                    onContextMenu={(event) => {
                      setSelectedGroupIds((current) =>
                        current.includes(group.id) ? current : [...current, group.id]
                      );
                      openContextMenu(
                        {
                          kind: "group",
                          group: {
                            id: group.id,
                            name: group.name,
                          },
                        },
                        event as unknown as MouseEvent
                      );
                    }}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                      selectedGroupIds.includes(group.id)
                        ? "border-slate-700 bg-slate-100"
                        : "border-slate-200 bg-white"
                    }`}
                    title={`${group.name}: ${count}`}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: group.color }}
                    />
                    {group.name} ({count})
                  </button>
                ))}
              </div>

              {groupCounts.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">No groups yet. Add one to get started.</p>
              ) : (
                <p className="mt-2 text-xs text-slate-500">Click groups to select multiple. Click again to deselect.</p>
              )}
              {groupError ? <p className="mt-1 text-xs text-amber-700">{groupError}</p> : null}
            </section>
          ) : null}

          {selectedEvent ? (
            <div className="absolute left-3 top-3 z-10 rounded border border-slate-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-800">Event View: {selectedEvent.name}</p>
                <button
                  onClick={handleClearSelectedEvent}
                  className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                >
                  Show full network
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Showing {selectedEvent.attendees.length} attendee{selectedEvent.attendees.length === 1 ? "" : "s"} and their existing connections.
              </p>
            </div>
          ) : null}

          <ForceGraph2D
            ref={graphRef}
            graphData={activeGraphData}
            linkLabel="type"
            onBackgroundClick={() => setContextMenu(null)}
            onNodeRightClick={(node, event) => {
              if ((node as { isEventOnly?: boolean }).isEventOnly) {
                setError("This attendee was added only for this event and is not in the main network yet.");
                return;
              }

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
              ctx.fillStyle = getRenderedNodeColor(node);
              ctx.fillText(label, (node.x ?? 0) + 6, (node.y ?? 0) + 3);
            }}
            nodeCanvasObjectMode={() => "after"}
            nodeColor={getRenderedNodeColor}
            linkColor={getRenderedLinkColor}
            linkWidth={getRenderedLinkWidth}
          />

          {contextMenu ? (
            <div
              style={{ left: contextMenu.x, top: contextMenu.y }}
              className="absolute z-20 min-w-44 rounded border border-slate-300 bg-white shadow-lg p-1"
              onClick={(event) => event.stopPropagation()}
            >
              {contextMenu.target.kind === "group" ? (
                <>
                  <button
                    onClick={() => {
                      void handleContextMenuEdit();
                    }}
                    className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-100"
                  >
                    Edit Group
                  </button>
                </>
              ) : contextMenu.target.kind === "node" ? (
                <>
                  <button
                    onClick={() => {
                      void handleContextMenuDelete();
                    }}
                    className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-100"
                  >
                    Delete Node
                  </button>
                  <button
                    onClick={() => {
                      void handleContextMenuEdit();
                    }}
                    className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-100"
                  >
                    Edit Name
                  </button>
                  <button
                    onClick={() => {
                      void handleContextMenuEditGroups();
                    }}
                    className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-100"
                  >
                    Edit Groups
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      void handleContextMenuDelete();
                    }}
                    className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-100"
                  >
                    Delete Connection
                  </button>
                  <button
                    onClick={() => {
                      void handleContextMenuEdit();
                    }}
                    className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-100"
                  >
                    Edit Type
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>

        {currentUserId ? (
          <aside
            style={{ top: rightPanelTop }}
            className="fixed right-0 bottom-0 z-20 w-96 border-l border-slate-200 bg-white shadow-lg flex flex-col"
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-200 p-3">
              <div>
                <h2 className="font-semibold text-slate-800">Planning Hub</h2>
                <p className="text-xs text-slate-500">Ask questions with Gemini or plan events from the graph.</p>
              </div>
              <button
                onClick={() => setIsSidebarMinimized((current) => !current)}
                className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
              >
                {isSidebarMinimized ? "▲" : "▼"}
              </button>
            </div>

            {!isSidebarMinimized ? (
              <>
                <div className="flex border-b border-slate-200">
                  <button
                    onClick={() => setSidebarTab("agent")}
                    className={`flex-1 px-3 py-2 text-sm font-medium ${
                      sidebarTab === "agent"
                        ? "border-b-2 border-violet-600 bg-violet-50 text-violet-700"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Gemini
                  </button>
                  <button
                    onClick={() => setSidebarTab("events")}
                    className={`flex-1 px-3 py-2 text-sm font-medium ${
                      sidebarTab === "events"
                        ? "border-b-2 border-violet-600 bg-violet-50 text-violet-700"
                        : "text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Events
                  </button>
                </div>

                {sidebarTab === "agent" ? (
                  <>
                    {agentError ? (
                      <div className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {agentError}
                      </div>
                    ) : null}

                    {agentMessages.length <= 1 ? (
                      <div className="p-3 border-b border-slate-200 space-y-2">
                        <p className="text-xs font-semibold text-slate-600 uppercase">Example Prompts</p>
                        <div className="space-y-1.5">
                          {EXAMPLE_PROMPTS.map((prompt, index) => (
                            <button
                              key={index}
                              onClick={() => {
                                void handleAskAgent(prompt);
                              }}
                              className="w-full text-left text-xs p-2 rounded border border-slate-200 hover:bg-violet-50 hover:border-violet-300 text-slate-700 transition"
                            >
                              {prompt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div
                      ref={agentMessagesScrollRef}
                      onScroll={handleAgentMessagesScroll}
                      className="flex-1 overflow-y-auto p-3 space-y-2"
                    >
                      {agentMessages.map((message, index) => (
                        <div
                          key={`${message.role}-${index}`}
                          className={
                            message.role === "user"
                              ? "ml-6 rounded bg-slate-800 text-white p-2 text-sm"
                              : "mr-6 rounded bg-slate-100 text-slate-800 p-2 text-sm"
                          }
                        >
                          {renderMessageText(message.text)}
                        </div>
                      ))}

                      {isAgentLoading ? (
                        <div
                          aria-live="polite"
                          className="mr-6 rounded bg-slate-100 text-slate-700 p-2 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <svg
                              className="h-4 w-4 animate-spin text-violet-600"
                              viewBox="0 0 24 24"
                              fill="none"
                              aria-hidden="true"
                            >
                              <circle
                                className="opacity-25"
                                cx="12"
                                cy="12"
                                r="10"
                                stroke="currentColor"
                                strokeWidth="4"
                              />
                              <path
                                className="opacity-75"
                                fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                              />
                            </svg>
                            <span className="inline-flex items-center gap-0.5">
                              Thinking
                              <span className="inline-flex w-6 justify-start">
                                <span className="animate-pulse">...</span>
                              </span>
                            </span>
                          </div>
                        </div>
                      ) : null}
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
                        className="w-full px-4 py-2 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isAgentLoading ? "Thinking..." : "Ask Agent"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="border-b border-slate-200 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-500">
                            {editingEventId ? "Edit event" : "Create event"}
                          </p>
                          <p className="text-sm text-slate-700">
                            {editingEventId
                              ? "Update the event name and attendee list."
                              : "Create a new saved event and choose attendees."}
                          </p>
                        </div>
                        {editingEventId ? (
                          <button
                            onClick={handleCancelEventEdit}
                            className="rounded bg-slate-100 px-3 py-2 text-xs text-slate-700 hover:bg-slate-200"
                          >
                            Cancel edit
                          </button>
                        ) : null}
                      </div>

                      <div className="space-y-1">
                        <label className="text-sm font-medium text-slate-700">Event name</label>
                        <input
                          value={eventDraftName}
                          onChange={(event) => {
                            setEventDraftName(event.target.value);
                            setEventError(null);
                          }}
                          placeholder="Quarterly offsite"
                          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">Add attendees</label>
                        <div className="flex gap-2">
                          <input
                            list="event-attendee-options"
                            value={eventAttendeeQuery}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setEventAttendeeQuery(nextValue);
                              setEventError(null);

                              const exactMatch = graphData.nodes.find(
                                (node) => normalizePersonName(node.name) === normalizePersonName(nextValue)
                              );

                              if (exactMatch) {
                                void handleAddEventAttendee(exactMatch.name);
                              }
                            }}
                            placeholder="Type an existing or new name"
                            className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
                          />
                          <button
                            onClick={() => {
                              void handleAddEventAttendee();
                            }}
                            className="rounded bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-900"
                          >
                            Add
                          </button>
                        </div>
                        <datalist id="event-attendee-options">
                          {graphData.nodes.map((node) => (
                            <option key={node.id} value={node.name} />
                          ))}
                        </datalist>
                        <div className="max-h-28 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2">
                          {eventDraftAttendees.length === 0 ? (
                            <p className="text-xs text-slate-500">No attendees added yet.</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {eventDraftAttendees.map((attendee) => (
                                <span
                                  key={attendee.id}
                                  className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-slate-700 border border-slate-200"
                                >
                                  {attendee.name}
                                  <button
                                    onClick={() => handleRemoveEventAttendee(attendee.id)}
                                    className="text-slate-400 hover:text-slate-700"
                                    aria-label={`Remove ${attendee.name}`}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {eventError ? <p className="text-xs text-red-600">{eventError}</p> : null}

                      <button
                        onClick={handleCreateEvent}
                        disabled={isLoadingEvents}
                        className="w-full rounded bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700"
                      >
                        {isLoadingEvents
                          ? "Saving..."
                          : editingEventId
                            ? "Save Changes"
                            : "Create Event"}
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase text-slate-500">Saved events</p>
                        {selectedEvent ? (
                          <button
                            onClick={handleClearSelectedEvent}
                            className="text-xs text-slate-500 hover:text-slate-700"
                          >
                            Clear view
                          </button>
                        ) : null}
                      </div>

                      {isLoadingEvents ? (
                        <p className="text-sm text-slate-500">Loading your events...</p>
                      ) : plannedEvents.length === 0 ? (
                        <p className="text-sm text-slate-500">No events created yet.</p>
                      ) : (
                        <div className="space-y-2">
                          {plannedEvents.map((event) => {
                            const isSelected = event.id === selectedEventId;
                            const customCount = event.attendees.filter((attendee) => !attendee.existingNodeId).length;

                            return (
                              <div
                                key={event.id}
                                className={`w-full rounded border px-3 py-2 text-left transition ${
                                  isSelected
                                    ? "border-violet-500 bg-violet-50"
                                    : "border-slate-200 bg-white hover:bg-slate-50"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleSelectEvent(event.id)}
                                  className="w-full text-left"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium text-slate-800">{event.name}</span>
                                    <span className="text-xs text-slate-500">{event.attendees.length} people</span>
                                  </div>
                                  <p className="mt-1 text-xs text-slate-500">
                                    {customCount > 0
                                      ? `${customCount} custom attendee${customCount === 1 ? "" : "s"}`
                                      : "All attendees exist in the network"}
                                  </p>
                                </button>

                                <div className="mt-2 flex items-center gap-2">
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                                    {isSelected ? "Selected" : "Saved"}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleBeginEditEvent(event.id)}
                                    className="rounded bg-violet-50 px-2 py-1 text-xs text-violet-700 hover:bg-violet-100"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void handleDeleteEvent(event.id);
                                    }}
                                    className="rounded bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : null}

            {isApprover ? (
              <section className="border-t border-slate-200 bg-white">
                <div className="flex items-center justify-between gap-2 bg-slate-100 px-4 py-2 border-b border-slate-300">
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
                    <div className="max-h-60 overflow-y-auto p-3 space-y-2">
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
                      className="w-full px-3 py-1.5 text-xs bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isLoadingPendingRequests ? "Refreshing..." : "Refresh"}
                    </button>
                  </>
                ) : null}
              </section>
            ) : null}
          </aside>
        ) : null}
      </div>
    </main>
  );
}