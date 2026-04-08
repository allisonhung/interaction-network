import { NextResponse } from "next/server";

type GraphNode = {
  id: string;
  name: string;
};

type GraphLink = {
  source: string;
  target: string;
  type: string;
};

type RequestBody = {
  question?: string;
  messageHistory?: Array<{
    role?: "user" | "assistant";
    text?: string;
  }>;
  graphData?: {
    nodes?: GraphNode[];
    links?: GraphLink[];
  };
};

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured." },
      { status: 500 }
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const question = body.question?.trim();
  const messageHistory = (body.messageHistory ?? [])
    .filter((message) => (message.text ?? "").trim().length > 0)
    .slice(-10)
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      text: (message.text ?? "").trim(),
    }));
  const nodes = body.graphData?.nodes ?? [];
  const links = body.graphData?.links ?? [];

  if (!question) {
    return NextResponse.json({ error: "Question is required." }, { status: 400 });
  }

  const compactGraph = {
    people: nodes.map((node) => ({ id: node.id, name: node.name })),
    relationships: links.map((link) => ({
      source: link.source,
      target: link.target,
      type: (link.type ?? "").toLowerCase(),
    })),
  };

  const systemPrompt =
    "You are a concise social dynamics analyst for a relationship graph. " +
    "CRITICAL: Keep all responses under 100 words. Use bullet points or numbered lists when appropriate. " +
    "Use only the graph data provided. Do not invent people or links. " +
    "Be direct and practical—no fluff. If data is insufficient, state what's missing in one sentence. " +
    "For party-invite questions, prefer sets that avoid enemies being together while maximizing friendly compatibility.";

  const userPrompt = [
    messageHistory.length > 0
      ? [
          "Recent conversation:",
          ...messageHistory.map((message) => `${message.role}: ${message.text}`),
          "",
          `Latest question: ${question}`,
        ].join("\n")
      : `Question: ${question}`,
    "",
    "Graph JSON:",
    JSON.stringify(compactGraph),
  ].join("\n");

  const candidateModels = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash-latest", "gemini-1.5-flash"];

  const listModelsResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );

  let discoveredModelNames: string[] = [];
  if (listModelsResponse.ok) {
    const listModelsJson = (await listModelsResponse.json()) as {
      models?: Array<{
        name?: string;
        supportedGenerationMethods?: string[];
      }>;
    };

    discoveredModelNames = (listModelsJson.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
      .map((model) => model.name ?? "")
      .filter(Boolean)
      .map((name) => name.replace(/^models\//, ""));
  }

  const orderedModelNames = Array.from(
    new Set([
      ...candidateModels,
      ...discoveredModelNames.filter((name) => name.includes("flash") || name.includes("pro")),
      ...discoveredModelNames,
    ])
  );

  const payload = JSON.stringify({
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  });

  let lastErrorText = "";

  for (const modelName of orderedModelNames) {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
        body: payload,
      }
    );

    if (!geminiResponse.ok) {
      lastErrorText = await geminiResponse.text();
      continue;
    }

    const json = (await geminiResponse.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const answer = json.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (answer) {
      return NextResponse.json({ answer });
    }

    lastErrorText = "No answer returned by model.";
  }

  return NextResponse.json(
    { error: `LLM request failed: ${lastErrorText || "No supported Gemini model responded."}` },
    { status: 502 }
  );
}
