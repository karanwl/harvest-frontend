export interface UserPreferences {
  dietaryStyle: string;
  allergies: string[];
  dislikedIngredients: string[];
  healthGoals: string[];
  householdSize: number;
  weeklyBudget: number | null;
  currency: string;
  maxCookingMinutes: number;
  preferredCuisines: string[];
  equipment: string[];
  mealsPerDay: number | null;
  planningDays: number;
  timezone: string;
  macroTargets: {
    calories: number | null;
    proteinGrams: number | null;
    carbohydrateGrams: number | null;
    fatGrams: number | null;
    fiberGrams: number | null;
  };
  bodyProfile: {
    ageYears: number | null;
    sexForEquation: "female" | "male" | "unspecified";
    heightCm: number | null;
    weightKg: number | null;
    goalWeightKg: number | null;
    goalPaceKgPerWeek: number | null;
    activityLevel:
      | "sedentary"
      | "lightly_active"
      | "moderately_active"
      | "very_active"
      | "extra_active";
  };
  mealSchedule: {
    wakeTime: string | null;
    sleepTime: string | null;
    breakfastTime: string | null;
    lunchTime: string | null;
    dinnerTime: string | null;
    workoutTime: string | null;
    scheduleNotes: string;
  };
  notes: string;
}

export interface CoachingCalculations {
  complete: boolean;
  bmi: number | null;
  bmiCategory: string | null;
  restingCalories: number | null;
  maintenanceCalories: number | null;
  goalCalories: number | null;
  weeklyWeightChangeKg: number | null;
  activityFactor: number | null;
  warnings: string[];
  method: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface PantryItem {
  name: string;
  quantity: string;
  category: string;
  expiresAt: string | null;
}

export interface MealPlan {
  title: string;
  startDate: string;
  rationale: string;
  timingRationale?: string;
  meals: Array<{
    day: string;
    date?: string;
    time?: string;
    mealType: string;
    name: string;
    description: string;
    servings: number;
    prepMinutes: number;
    cookMinutes: number;
    ingredients: Array<{
      name: string;
      quantity: string;
      category: string;
      form?: "fresh" | "frozen" | "canned" | "dry" | "pre-cooked" | "other";
      preparation?: string;
    }>;
    instructions: string[];
    donenessCues?: string;
    storageInstructions?: string;
    nutrition: {
      calories: number | null;
      proteinGrams: number | null;
      carbohydrateGrams?: number | null;
      fatGrams?: number | null;
      fiberGrams: number | null;
    };
  }>;
  advancePrep?: Array<{
    date: string;
    time: string;
    title: string;
    forMeal: string;
    instructions: string;
    durationMinutes: number;
    leadTimeHours?: number;
  }>;
  shoppingList: Array<{
    category: string;
    items: Array<{ name: string; quantity: string }>;
  }>;
}

export interface FavoriteRecipe {
  id: string;
  recipeKey: string;
  recipe: MealPlan["meals"][number];
  cookedCount: number;
  lastCookedAt: string | null;
  createdAt: string;
}

export interface PlanVersion {
  id: string;
  title: string;
  status: "draft" | "active" | "archived";
  plan: MealPlan;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  dietaryStyle: "No specific diet",
  allergies: [],
  dislikedIngredients: [],
  healthGoals: [],
  householdSize: 1,
  weeklyBudget: null,
  currency: "USD",
  maxCookingMinutes: 30,
  preferredCuisines: [],
  equipment: ["stovetop", "oven"],
  mealsPerDay: null,
  planningDays: 7,
  timezone: "UTC",
  macroTargets: {
    calories: null,
    proteinGrams: null,
    carbohydrateGrams: null,
    fatGrams: null,
    fiberGrams: null,
  },
  bodyProfile: {
    ageYears: null,
    sexForEquation: "unspecified",
    heightCm: null,
    weightKg: null,
    goalWeightKg: null,
    goalPaceKgPerWeek: 0.5,
    activityLevel: "sedentary",
  },
  mealSchedule: {
    wakeTime: null,
    sleepTime: null,
    breakfastTime: null,
    lunchTime: null,
    dinnerTime: null,
    workoutTime: null,
    scheduleNotes: "",
  },
  notes: "",
};

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(
  /\/$/,
  ""
);

export function getOrCreateUserId(): string {
  const storageKey = "harvest-user-id";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;
  const id = window.crypto.randomUUID();
  window.localStorage.setItem(storageKey, id);
  return id;
}

export type ChatProgressStage =
  | "starting"
  | "loading_context"
  | "routing"
  | "running_tool"
  | "repairing_output"
  | "saving_results";

export type RoutedChatTool = "advisor" | "preferences" | "pantry" | "planner";

export async function streamChat<T>(
  options: {
    userId: string;
    apiKey: string;
    signal: AbortSignal;
    body: {
      threadId: string;
      message: string;
      provider: string;
      model: string;
    };
    onProgress: (stage: ChatProgressStage, tool?: RoutedChatTool) => void;
  }
): Promise<T> {
  const response = await fetch(`${API_URL}/api/chat/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": options.userId,
      "x-provider-api-key": options.apiKey,
    },
    body: JSON.stringify(options.body),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "The request could not be started.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;

  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as {
        type: "progress" | "result" | "error";
        stage?: ChatProgressStage;
        tool?: RoutedChatTool;
        result?: T;
        error?: string;
      };
      if (event.type === "progress" && event.stage) {
        options.onProgress(event.stage, event.tool);
      }
      if (event.type === "result") result = event.result;
      if (event.type === "error") throw new Error(event.error ?? "The agent failed.");
    }
    if (chunk.done) break;
  }

  if (!result) throw new Error("The provider closed the request without a result.");
  return result;
}

export function getOrCreateThreadId(): string {
  const storageKey = "harvest-thread-id";
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;
  const id = window.crypto.randomUUID();
  window.localStorage.setItem(storageKey, id);
  return id;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { userId: string; apiKey?: string }
): Promise<T> {
  const { userId, apiKey, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);
  headers.set("x-user-id", userId);
  if (apiKey) headers.set("x-provider-api-key", apiKey);
  if (fetchOptions.body) headers.set("content-type", "application/json");

  const response = await fetch(`${API_URL}${path}`, {
    ...fetchOptions,
    headers,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed.");
  }
  return payload as T;
}
