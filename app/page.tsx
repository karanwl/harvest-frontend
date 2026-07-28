"use client";

import {
  Bot,
  CalendarClock,
  CalendarDays,
  Check,
  ChefHat,
  ClipboardCopy,
  Clock3,
  Eye,
  EyeOff,
  Heart,
  History,
  LoaderCircle,
  LogOut,
  MessageCircle,
  PackageOpen,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  ShoppingCart,
  ThumbsDown,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apiRequest,
  ChatProgressStage,
  ChatMessage,
  CoachingCalculations,
  DEFAULT_PREFERENCES,
  FavoriteRecipe,
  Account,
  deleteProviderKey,
  fetchAccount,
  listProviderKeys,
  ProviderKeySummary,
  saveProviderKey,
  streamPlanRevision,
  RevisionScope,
  getOrCreateThreadId,
  getSessionToken,
  signInWithGoogle,
  signOut,
  MealPlan,
  PlanVersion,
  PantryItem,
  RoutedChatTool,
  streamChat,
  UserPreferences,
} from "./api-client";

type View =
  | "chat"
  | "plan"
  | "favorites"
  | "shopping"
  | "pantry"
  | "preferences";
type Provider = "openai" | "anthropic" | "google" | "deepseek";
type ChatTool = RoutedChatTool;
type PlannedMeal = MealPlan["meals"][number];
type MacroKey = keyof UserPreferences["macroTargets"];

const MODEL_OPTIONS: Record<Provider, string[]> = {
  openai: ["gpt-5.6", "gpt-5.6-terra", "gpt-5.6-luna"],
  anthropic: ["claude-sonnet-5", "claude-haiku-4-5"],
  google: ["gemini-3.6-flash", "gemini-3.5-flash-lite"],
  deepseek: ["deepseek-v4-pro", "deepseek-v4-flash"],
};

const ROUTED_PROGRESS: Record<ChatTool, string> = {
  advisor: "Thinking through your request…",
  preferences: "Remembering your preferences…",
  pantry: "Updating what you have on hand…",
  planner: "Building recipes, macros, and a shopping list…",
};

const CHAT_SUGGESTIONS = [
  "I prefer Indian food and quick meals",
  "I have eggs, spinach, and rice",
  "How can I eat more fiber?",
  "Create a five-day macro-conscious dinner plan",
];

const MACROS: Array<{ key: MacroKey; label: string; shortLabel: string; unit: string }> = [
  { key: "calories", label: "Calories", shortLabel: "kcal", unit: "kcal" },
  { key: "proteinGrams", label: "Protein", shortLabel: "protein", unit: "g" },
  {
    key: "carbohydrateGrams",
    label: "Carbohydrates",
    shortLabel: "carbs",
    unit: "g",
  },
  { key: "fatGrams", label: "Fat", shortLabel: "fat", unit: "g" },
  { key: "fiberGrams", label: "Fiber", shortLabel: "fiber", unit: "g" },
];

const COMMON_TIMEZONES = [
  "America/Toronto",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
];

function commaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalNumber(value: string): number | null {
  return value ? Number(value) : null;
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

/** The slice of Google Identity Services this app uses. */
interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential?: string }) => void;
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: Record<string, string | number>
      ): void;
      disableAutoSelect(): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

export default function Home() {
  const [view, setView] = useState<View>("chat");
  const [userId, setUserId] = useState("");
  const [threadId, setThreadId] = useState("");
  const [provider, setProvider] = useState<Provider>("openai");
  const [routedTool, setRoutedTool] = useState<ChatTool | null>(null);
  const [model, setModel] = useState(MODEL_OPTIONS.openai[0]);
  const [customModel, setCustomModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [providerKeys, setProviderKeys] = useState<ProviderKeySummary[]>([]);
  const [revisionTarget, setRevisionTarget] = useState<{
    scope: RevisionScope;
    label: string;
  } | null>(null);
  const [revisionText, setRevisionText] = useState("");
  const [revising, setRevising] = useState(false);
  const [revisionStage, setRevisionStage] =
    useState<ChatProgressStage>("starting");
  const revisionRequest = useRef<AbortController | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [favorites, setFavorites] = useState<FavoriteRecipe[]>([]);
  const [planVersions, setPlanVersions] = useState<PlanVersion[]>([]);
  const [selectedMeal, setSelectedMeal] = useState<PlannedMeal | null>(null);
  const [pantry, setPantry] = useState<PantryItem[]>([]);
  const [preferences, setPreferences] =
    useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [coaching, setCoaching] = useState<CoachingCalculations | null>(null);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<Account | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState("");
  const [claimedAnonymousData, setClaimedAnonymousData] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [sending, setSending] = useState(false);
  const [progressStage, setProgressStage] =
    useState<ChatProgressStage>("starting");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);
  const [clearingPlan, setClearingPlan] = useState(false);
  const [checkedShoppingItems, setCheckedShoppingItems] = useState<string[]>([]);
  const [shoppingCopied, setShoppingCopied] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState("");
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [showPlanHistory, setShowPlanHistory] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const activeModel = customModel.trim() || model;
  const weekDays = useMemo(() => {
    const days = new Map<
      string,
      { day: string; date?: string; meals: PlannedMeal[] }
    >();
    for (const meal of plan?.meals ?? []) {
      const key = meal.date || meal.day;
      const existing = days.get(key);
      if (existing) {
        existing.meals.push(meal);
      } else {
        days.set(key, { day: meal.day, date: meal.date, meals: [meal] });
      }
    }
    return [...days.values()];
  }, [plan]);
  const advancePrep = useMemo(
    () =>
      [...(plan?.advancePrep ?? [])].sort((left, right) =>
        `${left.date}T${left.time}`.localeCompare(`${right.date}T${right.time}`)
      ),
    [plan]
  );
  const planMacroSummary = useMemo(
    () => summarizeMacros(plan?.meals ?? [], Math.max(weekDays.length, 1)),
    [plan, weekDays.length]
  );
  const shoppingEntries = useMemo(
    () =>
      (plan?.shoppingList ?? []).flatMap((group) =>
        group.items.map((item) => ({
          ...item,
          category: group.category,
          key: `${group.category}::${item.name}::${item.quantity}`,
        }))
      ),
    [plan]
  );
  const shoppingStorageKey =
    userId && plan
      ? `harvest-shopping-checks:${userId}:${plan.startDate}:${plan.title}`
      : "";
  const checkedShoppingSet = useMemo(
    () => new Set(checkedShoppingItems),
    [checkedShoppingItems]
  );
  const checkedShoppingCount = shoppingEntries.filter((item) =>
    checkedShoppingSet.has(item.key)
  ).length;
  const localClock = getLocalClock(preferences.timezone);
  const focusDay =
    weekDays.find((day) => day.date === localClock.date) ??
    weekDays.find((day) => Boolean(day.date && day.date > localClock.date)) ??
    weekDays[0] ??
    null;
  const focusMeals = useMemo(
    () =>
      [...(focusDay?.meals ?? [])].sort((left, right) =>
        (left.time ?? "23:59").localeCompare(right.time ?? "23:59")
      ),
    [focusDay]
  );
  const nextMeal =
    focusMeals.find(
      (meal) =>
        focusDay?.date !== localClock.date ||
        !meal.time ||
        meal.time >= localClock.time
    ) ?? focusMeals[focusMeals.length - 1] ?? null;
  const urgentPrep = advancePrep.filter(
    (task) =>
      getPrepUrgency(task.date, task.time, preferences.timezone) !== null
  );
  const macroCompleteMeals = (plan?.meals ?? []).filter((meal) =>
    MACROS.every((macro) => typeof meal.nutrition[macro.key] === "number")
  ).length;
  const uniqueMealCount = new Set(
    (plan?.meals ?? []).map((meal) => meal.name.trim().toLocaleLowerCase())
  ).size;
  const calorieTarget =
    preferences.macroTargets.calories ?? coaching?.goalCalories ?? null;
  const calorieAlignment =
    calorieTarget && planMacroSummary.daily.calories
      ? Math.round(
          (planMacroSummary.daily.calories / calorieTarget) * 100
        )
      : null;

  useEffect(() => {
    if (!shoppingStorageKey) {
      setCheckedShoppingItems([]);
      return;
    }
    try {
      const savedChecks = JSON.parse(
        window.localStorage.getItem(shoppingStorageKey) ?? "[]"
      );
      setCheckedShoppingItems(
        Array.isArray(savedChecks)
          ? savedChecks.filter((item): item is string => typeof item === "string")
          : []
      );
    } catch {
      setCheckedShoppingItems([]);
    }
  }, [shoppingStorageKey]);

  useEffect(() => {
    if (!selectedMeal) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedMeal(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedMeal]);

  useEffect(() => {
    if (!sending) return;
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(
      () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000
    );
    return () => window.clearInterval(timer);
  }, [sending]);

  // Restore an existing session before deciding what to render.
  useEffect(() => {
    if (!getSessionToken()) {
      setAuthChecking(false);
      return;
    }
    fetchAccount()
      .then(setAccount)
      .catch(() => signOut())
      .finally(() => setAuthChecking(false));
  }, []);

  const handleGoogleCredential = useCallback(async (credential: string) => {
    setAuthError("");
    try {
      const session = await signInWithGoogle(credential);
      setAccount(session.account);
      setClaimedAnonymousData(session.claimedAnonymousData);
    } catch (caught) {
      setAuthError(
        caught instanceof Error ? caught.message : "Google sign-in failed."
      );
    }
  }, []);

  // Load Google Identity Services only while signed out.
  useEffect(() => {
    if (account || authChecking || !GOOGLE_CLIENT_ID) return;

    let cancelled = false;
    function renderButton() {
      if (cancelled || !window.google || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => {
          if (response.credential) {
            void handleGoogleCredential(response.credential);
          }
        },
        cancel_on_tap_outside: false,
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width: 280,
      });
    }

    if (window.google) {
      renderButton();
      return () => {
        cancelled = true;
      };
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_SCRIPT_SRC}"]`
    );
    const script = existing ?? document.createElement("script");
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", renderButton);
    script.addEventListener("error", () => {
      if (!cancelled) setAuthError("Could not reach Google sign-in.");
    });
    if (!existing) document.head.appendChild(script);

    return () => {
      cancelled = true;
      script.removeEventListener("load", renderButton);
    };
  }, [account, authChecking, handleGoogleCredential]);

  function handleSignOut() {
    window.google?.accounts.id.disableAutoSelect();
    signOut();
    setAccount(null);
    setClaimedAnonymousData(false);
    setMessages([]);
    setPlan(null);
    setPantry([]);
    setFavorites([]);
    setPlanVersions([]);
    setCoaching(null);
    setPreferences(DEFAULT_PREFERENCES);
    setApiKey("");
    setProviderKeys([]);
    setUserId("");
    setLoading(true);
  }

  useEffect(() => {
    if (!account) return;
    const nextThreadId = getOrCreateThreadId();
    setUserId(account.userId);
    setThreadId(nextThreadId);
    setApiKey("");
    setLoading(true);

    Promise.all([
      apiRequest<{
        preferences: UserPreferences;
        pantry: PantryItem[];
        plan: MealPlan | null;
        coaching: CoachingCalculations;
        favorites: FavoriteRecipe[];
        versions: PlanVersion[];
      }>(
        "/api/bootstrap",
        {}
      ),
      apiRequest<{ messages: ChatMessage[] }>(
        `/api/chat/history?threadId=${nextThreadId}`,
        {}
      ),
      listProviderKeys().catch(() => [] as ProviderKeySummary[]),
    ])
      .then(([bootstrap, history, keys]) => {
        setProviderKeys(keys);
        setPreferences(bootstrap.preferences);
        setPantry(bootstrap.pantry);
        setPlan(bootstrap.plan);
        setFavorites(bootstrap.favorites);
        setPlanVersions(bootstrap.versions);
        setCoaching(bootstrap.coaching);
        setMessages(history.messages);
      })
      .catch((caught) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not connect to the backend."
        );
      })
      .finally(() => setLoading(false));
  }, [account]);

  const title = useMemo(() => {
    if (view === "plan") return "This week, thoughtfully planned";
    if (view === "favorites") return "Recipes worth remembering";
    if (view === "shopping") return "Everything still to pick up";
    if (view === "pantry") return "Cook from what you have";
    if (view === "preferences") return "Make Harvest feel like yours";
    return "What can Harvest help with?";
  }, [view]);

  function changeProvider(nextProvider: Provider) {
    setProvider(nextProvider);
    setModel(MODEL_OPTIONS[nextProvider][0]);
    setCustomModel("");
  }

  const savedKey = providerKeys.find((entry) => entry.provider === provider);
  const canChat = Boolean(savedKey) || apiKey.length >= 8;

  async function storeProviderKey() {
    const trimmed = apiKey.trim();
    if (trimmed.length < 8 || savingKey) return;
    setSavingKey(true);
    setError("");
    try {
      setProviderKeys(await saveProviderKey(provider, trimmed));
      // The server holds it now; drop the browser's plaintext copy.
      setApiKey("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not save the key."
      );
    } finally {
      setSavingKey(false);
    }
  }

  async function removeProviderKey(target: Provider) {
    setError("");
    try {
      setProviderKeys(await deleteProviderKey(target));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not remove the key."
      );
    }
  }

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const text = message.trim();
    if (!text || !canChat || !userId || !threadId || sending) return;

    setError("");
    setSending(true);
    setProgressStage("starting");
    setRoutedTool(null);
    setMessage("");
    const optimistic: ChatMessage = {
      id: window.crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);

    try {
      const controller = new AbortController();
      let completedTool: ChatTool | null = null;
      activeRequest.current = controller;
      const result = await streamChat<{
        assistantMessage: string;
        preferenceUpdates: Record<string, unknown>;
        pantryUpdates: {
          upsert: PantryItem[];
          remove: string[];
          clear: boolean;
        };
        plan: MealPlan | null;
      }>({
        // Omitted when a saved key should be used; only sent for a one-off key.
        apiKey: apiKey.trim() || undefined,
        signal: controller.signal,
        onProgress: (stage, tool) => {
          setProgressStage(stage);
          if (tool) {
            completedTool = tool;
            setRoutedTool(tool);
          }
        },
        body: {
          threadId,
          message: text,
          provider,
          model: activeModel,
        },
      });
      setMessages((current) => [
        ...current,
        {
          id: window.crypto.randomUUID(),
          role: "assistant",
          content: result.assistantMessage,
          createdAt: new Date().toISOString(),
        },
      ]);
      if (result.plan) {
        setPlan(result.plan);
        setSelectedMeal(null);
        setView("plan");
      }
      if (completedTool === "planner") {
        try {
          const [persisted, history] = await Promise.all([
            apiRequest<{ plan: MealPlan | null }>("/api/plans/current", {
            }),
            apiRequest<{ versions: PlanVersion[] }>("/api/plans/history", {
            }),
          ]);
          setPlanVersions(history.versions);
          if (persisted.plan) {
            setPlan(persisted.plan);
            setSelectedMeal(null);
            setView("plan");
          } else if (!result.plan) {
            setError(
              "The response completed, but no structured meal plan was saved. Ask me to create the plan again."
            );
          }
        } catch (planError) {
          if (!result.plan) {
            setError(
              planError instanceof Error
                ? `The plan response completed but My week could not refresh: ${planError.message}`
                : "The plan response completed but My week could not refresh."
            );
          }
        }
      }
      if (Object.keys(result.preferenceUpdates).length > 0) {
        const [refreshed, coachingResult] = await Promise.all([
          apiRequest<{ preferences: UserPreferences }>("/api/preferences", {
          }),
          apiRequest<{ coaching: CoachingCalculations }>("/api/coaching", {
          }),
        ]);
        setPreferences(refreshed.preferences);
        setCoaching(coachingResult.coaching);
      }
      if (
        result.pantryUpdates.clear ||
        result.pantryUpdates.upsert.length > 0 ||
        result.pantryUpdates.remove.length > 0
      ) {
        const refreshed = await apiRequest<{ pantry: PantryItem[] }>(
          "/api/pantry",
          {}
        );
        setPantry(refreshed.pantry);
      }
    } catch (caught) {
      setMessage(text);
      setError(
        caught instanceof DOMException && caught.name === "AbortError"
          ? "Planning cancelled. Your previous memories are unchanged."
          : caught instanceof Error
          ? caught.message
          : "The agent could not respond."
      );
    } finally {
      activeRequest.current = null;
      setSending(false);
    }
  }

  function cancelPlanning() {
    activeRequest.current?.abort();
  }

  async function clearChat() {
    if (
      !window.confirm(
        "Clear this conversation? Your saved preferences, pantry, and meal plan will remain."
      )
    ) {
      return;
    }
    setClearingChat(true);
    setError("");
    try {
      await apiRequest<{ cleared: boolean; deletedMessages: number }>(
        `/api/chat/history?threadId=${threadId}`,
        { method: "DELETE" }
      );
      setMessages([]);
      setRoutedTool(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear chat.");
    } finally {
      setClearingChat(false);
    }
  }

  async function clearPlan() {
    if (
      !window.confirm(
        "Clear the current meal plan? Your preferences, pantry, and chat will remain."
      )
    ) {
      return;
    }
    setClearingPlan(true);
    setError("");
    try {
      await apiRequest<{ cleared: boolean; archived: boolean }>(
        "/api/plans/current",
        { method: "DELETE" }
      );
      setPlan(null);
      setSelectedMeal(null);
      const history = await apiRequest<{ versions: PlanVersion[] }>(
        "/api/plans/history",
        {}
      );
      setPlanVersions(history.versions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear plan.");
    } finally {
      setClearingPlan(false);
    }
  }

  async function restoreVersion(version: PlanVersion) {
    if (
      !window.confirm(
        `Restore “${version.title}”? The current plan will remain available in history.`
      )
    ) {
      return;
    }
    setRestoringVersion(version.id);
    setError("");
    try {
      const result = await apiRequest<{
        plan: MealPlan;
        versions: PlanVersion[];
      }>(`/api/plans/history/${version.id}/restore`, {
        method: "POST",
      });
      setPlan(result.plan);
      setPlanVersions(result.versions);
      setSelectedMeal(null);
      setShowPlanHistory(false);
      setView("plan");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not restore plan.");
    } finally {
      setRestoringVersion("");
    }
  }

  async function savePreferenceForm(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const result = await apiRequest<{
        preferences: UserPreferences;
        coaching: CoachingCalculations;
      }>(
        "/api/preferences",
        {
          method: "PUT",
          body: JSON.stringify(preferences),
        }
      );
      setPreferences(result.preferences);
      setCoaching(result.coaching);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save preferences.");
    } finally {
      setSaving(false);
    }
  }

  async function removePantryItem(name: string) {
    const nextPantry = pantry.filter(
      (item) => item.name.toLocaleLowerCase() !== name.toLocaleLowerCase()
    );
    setError("");
    try {
      const result = await apiRequest<{ pantry: PantryItem[] }>("/api/pantry", {
        method: "PUT",
        body: JSON.stringify({ pantry: nextPantry }),
      });
      setPantry(result.pantry);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update pantry.");
    }
  }

  function describePantry() {
    setMessage(
      pantry.length === 0
        ? "I have these ingredients on hand: "
        : "Update what I have on hand: "
    );
    setView("chat");
  }

  function useBrowserTimezone() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) setPreferences((current) => ({ ...current, timezone }));
  }

  function updateBodyProfile(
    updates: Partial<UserPreferences["bodyProfile"]>
  ) {
    setPreferences((current) => ({
      ...current,
      bodyProfile: { ...current.bodyProfile, ...updates },
    }));
  }

  function updateMealSchedule(
    updates: Partial<UserPreferences["mealSchedule"]>
  ) {
    setPreferences((current) => ({
      ...current,
      mealSchedule: { ...current.mealSchedule, ...updates },
    }));
  }

  function toggleShoppingItem(key: string) {
    setCheckedShoppingItems((current) => {
      const next = current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key];
      if (shoppingStorageKey) {
        window.localStorage.setItem(shoppingStorageKey, JSON.stringify(next));
      }
      return next;
    });
  }

  function clearShoppingChecks() {
    setCheckedShoppingItems([]);
    if (shoppingStorageKey) window.localStorage.removeItem(shoppingStorageKey);
  }

  async function copyShoppingList() {
    const text = (plan?.shoppingList ?? [])
      .map(
        (group) =>
          `${group.category}\n${group.items
            .map((item) => `- ${item.name}: ${item.quantity}`)
            .join("\n")}`
      )
      .join("\n\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setShoppingCopied(true);
      window.setTimeout(() => setShoppingCopied(false), 2000);
    } catch {
      setError("Could not copy the shopping list in this browser.");
    }
  }

  // Revision happens against the plan itself. The scope travels as data, so a
  // one-meal edit stays a one-meal edit regardless of what the user types.
  function openRevision(scope: RevisionScope, label: string) {
    setRevisionTarget({ scope, label });
    setRevisionText("");
    setError("");
  }

  function closeRevision() {
    revisionRequest.current?.abort();
    revisionRequest.current = null;
    setRevisionTarget(null);
    setRevisionText("");
    setRevising(false);
  }

  function reviseMeal(meal: PlannedMeal) {
    openRevision(
      {
        kind: "meal",
        date: meal.date || meal.day,
        mealName: meal.name,
        mealType: meal.mealType,
      },
      meal.name
    );
  }

  function reviseDay(day: { day: string; date?: string }) {
    openRevision({ kind: "day", date: day.date || day.day }, day.day);
  }

  function reviseWholePlan() {
    openRevision({ kind: "plan" }, "the whole plan");
  }

  function rebalancePlanMacros() {
    openRevision({ kind: "plan" }, "the whole plan");
    setRevisionText(
      "Rebalance every day to meet my saved daily macro targets by changing real ingredients and portions."
    );
  }

  async function submitRevision(event?: FormEvent) {
    event?.preventDefault();
    if (!revisionTarget || revising || !canChat) return;

    const controller = new AbortController();
    revisionRequest.current = controller;
    setRevising(true);
    setRevisionStage("starting");
    setError("");

    try {
      const result = await streamPlanRevision<{
        plan: MealPlan | null;
        assistantMessage: string;
      }>({
        apiKey: apiKey.trim() || undefined,
        signal: controller.signal,
        body: {
          threadId,
          scope: revisionTarget.scope,
          instruction: revisionText.trim(),
          provider,
          model: activeModel,
        },
        onProgress: (stage) => setRevisionStage(stage),
      });

      if (result.plan) {
        setPlan(result.plan);
        // Keep the open recipe in sync with the meal that just replaced it.
        setSelectedMeal((current) =>
          current
            ? result.plan!.meals.find(
                (meal) =>
                  (meal.date || meal.day) === (current.date || current.day) &&
                  meal.mealType === current.mealType
              ) ?? null
            : null
        );
      }
      setRevisionTarget(null);
      setRevisionText("");
      apiRequest<{ versions: PlanVersion[] }>("/api/plans/history", {})
        .then((history) => setPlanVersions(history.versions))
        .catch(() => undefined);
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;
      setError(
        caught instanceof Error ? caught.message : "The revision failed."
      );
    } finally {
      revisionRequest.current = null;
      setRevising(false);
    }
  }

  function favoriteForMeal(meal: PlannedMeal): FavoriteRecipe | undefined {
    return favorites.find(
      (favorite) =>
        favorite.recipe.name.toLocaleLowerCase() ===
          meal.name.toLocaleLowerCase() &&
        favorite.recipe.mealType.toLocaleLowerCase() ===
          meal.mealType.toLocaleLowerCase()
    );
  }

  async function toggleFavorite(meal: PlannedMeal) {
    if (feedbackSaving) return;
    setFeedbackSaving(true);
    setFeedbackNotice("");
    setError("");
    try {
      const existing = favoriteForMeal(meal);
      if (existing) {
        await apiRequest<{ removed: boolean }>(
          `/api/favorites/${existing.id}`,
          { method: "DELETE" }
        );
        setFavorites((current) =>
          current.filter((favorite) => favorite.id !== existing.id)
        );
        setFeedbackNotice("Removed from favorites.");
      } else {
        const result = await apiRequest<{ favorite: FavoriteRecipe }>(
          "/api/favorites",
          {
            method: "POST",
            body: JSON.stringify({ recipe: meal }),
          }
        );
        setFavorites((current) => [
          result.favorite,
          ...current.filter(
            (favorite) => favorite.id !== result.favorite.id
          ),
        ]);
        setFeedbackNotice("Saved as a favorite. Future plans will remember it.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update favorites.");
    } finally {
      setFeedbackSaving(false);
    }
  }

  async function recordMealFeedback(
    meal: PlannedMeal,
    feedback: "cooked" | "not_for_me"
  ) {
    if (feedbackSaving) return;
    const reason =
      feedback === "not_for_me"
        ? window.prompt(
            "Optional: what did not work? This helps future plans improve."
          )
        : null;
    setFeedbackSaving(true);
    setFeedbackNotice("");
    setError("");
    try {
      const existing = favoriteForMeal(meal);
      await apiRequest<{ recorded: boolean }>("/api/meal-feedback", {
        method: "POST",
        body: JSON.stringify({
          mealName: meal.name,
          feedback,
          favoriteId: existing?.id ?? null,
          reason: reason?.trim() || null,
        }),
      });
      if (feedback === "cooked" && existing) {
        const refreshed = await apiRequest<{ favorites: FavoriteRecipe[] }>(
          "/api/favorites",
          {}
        );
        setFavorites(refreshed.favorites);
      }
      if (feedback === "not_for_me" && existing) {
        await apiRequest<{ removed: boolean }>(
          `/api/favorites/${existing.id}`,
          { method: "DELETE" }
        );
        setFavorites((current) =>
          current.filter((favorite) => favorite.id !== existing.id)
        );
      }
      setFeedbackNotice(
        feedback === "cooked"
          ? "Meal logged. The coach will use that history."
          : "Feedback saved. Future plans will avoid this pattern."
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save feedback.");
    } finally {
      setFeedbackSaving(false);
    }
  }

  function useFavoriteAgain(favorite: FavoriteRecipe) {
    setMessage(
      `Use my favorite recipe "${favorite.recipe.name}" in the next plan or adapt it to fit my current targets and pantry.`
    );
    setSelectedMeal(null);
    setView("chat");
  }

  const navItems: Array<{
    id: View;
    label: string;
    icon: typeof MessageCircle;
  }> = [
    { id: "chat", label: "Chat", icon: MessageCircle },
    { id: "plan", label: "My week", icon: CalendarDays },
    { id: "favorites", label: "Favorites", icon: Heart },
    { id: "shopping", label: "To buy", icon: ShoppingCart },
    { id: "pantry", label: "On hand", icon: PackageOpen },
    { id: "preferences", label: "Preferences", icon: Settings2 },
  ];

  if (authChecking) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <LoaderCircle className="spin" size={22} />
          <p className="auth-subtitle">Checking your session…</p>
        </div>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="brand-mark">H</div>
          <h1 className="auth-title">Harvest</h1>
          <p className="auth-subtitle">
            Sign in with Google to keep your preferences, pantry, and plans on
            every device.
          </p>

          {GOOGLE_CLIENT_ID ? (
            <div className="auth-button" ref={googleButtonRef} />
          ) : (
            <p className="auth-error">
              Google sign-in is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID
              and redeploy.
            </p>
          )}

          {authError && <p className="auth-error">{authError}</p>}

          <p className="auth-fineprint">
            Harvest stores the email address on your Google account to identify
            you. Your AI provider key is never sent to Google and is never saved
            on our servers.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">H</div>
          <div>
            <div className="brand-name">Harvest</div>
            <div className="brand-subtitle">Personal meal intelligence</div>
          </div>
        </div>
        <nav className="nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-button ${view === item.id ? "active" : ""}`}
                onClick={() => setView(item.id)}
              >
                <Icon size={18} />
                {item.label}
                {item.id === "shopping" && shoppingEntries.length > 0 && (
                  <span className="nav-count">{shoppingEntries.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="privacy-note">
          <strong>
            <ShieldCheck size={15} /> Your key stays yours
          </strong>
          Saved provider keys are encrypted before they are stored and are only
          ever decrypted to call that provider on your behalf. Harvest never
          shows a saved key again, and you can remove it at any time.
        </div>
        <div className="account-row">
          {account.pictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="account-avatar"
              src={account.pictureUrl}
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="account-avatar account-avatar-fallback">
              {(account.displayName ?? account.email ?? "?")
                .slice(0, 1)
                .toUpperCase()}
            </div>
          )}
          <div className="account-identity">
            <span className="account-name">
              {account.displayName ?? "Signed in"}
            </span>
            <span className="account-email">{account.email}</span>
          </div>
          <button
            type="button"
            className="account-signout"
            onClick={handleSignOut}
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="main">
        {revisionTarget && (
          <form className="revision-panel" onSubmit={submitRevision}>
            <div className="revision-heading">
              <RefreshCw size={15} className={revising ? "spin" : ""} />
              <span>
                Revising <strong>{revisionTarget.label}</strong>
              </span>
              <button
                type="button"
                className="revision-close"
                onClick={closeRevision}
                aria-label="Cancel revision"
              >
                <X size={15} />
              </button>
            </div>

            <input
              className="input"
              autoFocus
              value={revisionText}
              onChange={(event) => setRevisionText(event.target.value)}
              disabled={revising}
              placeholder={
                revisionTarget.scope.kind === "meal"
                  ? "What should change? e.g. make it vegetarian, less spicy, quicker"
                  : "What should change? Leave blank to let Harvest improve it."
              }
            />

            <div className="revision-actions">
              {revising ? (
                <>
                  <span className="revision-status">
                    {revisionStage === "running_tool"
                      ? "Rewriting…"
                      : revisionStage === "repairing_output"
                      ? "Refining…"
                      : revisionStage === "saving_results"
                      ? "Saving…"
                      : "Starting…"}
                  </span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={closeRevision}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="revision-status">
                    {canChat
                      ? "Everything outside this scope stays exactly as it is."
                      : "Add a provider API key to revise."}
                  </span>
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={!canChat}
                  >
                    Revise
                  </button>
                </>
              )}
            </div>
          </form>
        )}
        {claimedAnonymousData && (
          <div className="claim-banner">
            <Check size={16} />
            <span>
              The preferences, pantry, and plans you built on this device are now
              saved to {account.email ?? "your account"}.
            </span>
            <button
              type="button"
              onClick={() => setClaimedAnonymousData(false)}
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>
        )}
        <header className="topbar">
          <div>
            <div className="eyebrow">Your kitchen · your rules</div>
            <h1>{title}</h1>
          </div>
          <div className="model-pill">
            {provider} · {activeModel}
          </div>
        </header>

        <div className="content">
          {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}
          {loading ? (
            <div className="card plan-empty">
              <LoaderCircle size={28} className="spin" />
              <p>Loading your kitchen memory…</p>
            </div>
          ) : view === "chat" ? (
            <div className="chat-layout">
              <section className="card chat-card">
                <div className="chat-intro">
                  <div className="chat-intro-row">
                    <div>
                      <h2>One conversation, all your kitchen context</h2>
                      <p>
                        Share preferences, pantry updates, questions, or planning
                        requests naturally. Harvest handles the rest.
                      </p>
                    </div>
                    {messages.length > 0 && (
                      <button
                        className="clear-button"
                        onClick={() => void clearChat()}
                        disabled={sending || clearingChat}
                      >
                        {clearingChat ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                        Clear chat
                      </button>
                    )}
                  </div>
                </div>
                <div className="messages">
                  {messages.length === 0 ? (
                    <div className="empty-chat">
                      <Sparkles size={30} />
                      <h3>Start with the week you actually have</h3>
                      <p>
                        Mention your schedule, ingredients, budget, goals, or what
                        simply sounds good.
                      </p>
                      <div className="suggestions">
                        {CHAT_SUGGESTIONS.map((suggestion) => (
                          <button
                            className="suggestion"
                            key={suggestion}
                            onClick={() => setMessage(suggestion)}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.map((item) => (
                      <div key={item.id} className={`message ${item.role}`}>
                        {item.content}
                      </div>
                    ))
                  )}
                  {sending && (
                    <div className="message assistant progress-message">
                      <div className="progress-title">
                        <LoaderCircle size={16} className="spin" />
                        {progressStage === "running_tool"
                          ? routedTool
                            ? ROUTED_PROGRESS[routedTool]
                            : "Working on your request…"
                          : progressStage === "repairing_output"
                          ? "Repairing an incomplete provider response…"
                          : progressStage === "saving_results"
                          ? "Saving the result and allowed memories…"
                          : progressStage === "loading_context"
                          ? "Loading relevant memory and context…"
                          : progressStage === "routing"
                          ? "Understanding your request…"
                          : "Starting automatic routing…"}
                      </div>
                      <div className="progress-detail">
                        {elapsedSeconds}s elapsed · {provider} · {activeModel}
                      </div>
                      <div className="progress-track">
                        <span className={`done ${progressStage !== "starting" ? "active" : ""}`} />
                        <span className={progressStage === "routing" || progressStage === "running_tool" || progressStage === "repairing_output" || progressStage === "saving_results" ? "active" : ""} />
                        <span className={progressStage === "running_tool" || progressStage === "repairing_output" || progressStage === "saving_results" ? "active" : ""} />
                        <span className={progressStage === "saving_results" ? "active" : ""} />
                      </div>
                      <button
                        type="button"
                        className="cancel-button"
                        onClick={cancelPlanning}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                <form className="composer" onSubmit={sendMessage}>
                  <textarea
                    aria-label="Message Harvest"
                    placeholder="Share a preference, update your pantry, ask a question, or request a plan…"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                  />
                  <button
                    className="primary-button"
                    aria-label="Send"
                    disabled={!message.trim() || !canChat || sending}
                  >
                    <Send size={18} />
                  </button>
                </form>
              </section>

              <aside className="card settings-card">
                <Bot size={22} />
                <h3>Choose your cook</h3>
                <p>
                  Bring your own model. A custom model ID overrides the suggested
                  model.
                </p>
                <div className="field">
                  <label htmlFor="provider">Provider</label>
                  <select
                    id="provider"
                    value={provider}
                    onChange={(event) =>
                      changeProvider(event.target.value as Provider)
                    }
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                    <option value="deepseek">DeepSeek</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="model">Suggested model</label>
                  <select
                    id="model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  >
                    {MODEL_OPTIONS[provider].map((modelName) => (
                      <option key={modelName}>{modelName}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="custom-model">Custom model ID</label>
                  <input
                    className="input"
                    id="custom-model"
                    value={customModel}
                    onChange={(event) => setCustomModel(event.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <div className="field">
                  <label htmlFor="api-key">
                    {provider} API key
                  </label>
                  <div className="key-row">
                    <input
                      className="input"
                      id="api-key"
                      type={showKey ? "text" : "password"}
                      autoComplete="off"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={
                        savedKey ? "Replace the saved key" : "Paste your key"
                      }
                    />
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => setShowKey((current) => !current)}
                      aria-label={showKey ? "Hide API key" : "Show API key"}
                    >
                      {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>

                  <div className="key-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={storeProviderKey}
                      disabled={apiKey.trim().length < 8 || savingKey}
                    >
                      {savingKey
                        ? "Saving…"
                        : savedKey
                        ? "Replace saved key"
                        : "Save key to my account"}
                    </button>
                    {savedKey && (
                      <button
                        type="button"
                        className="ghost-button danger"
                        onClick={() => removeProviderKey(provider)}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="key-status">
                    <span className={`dot ${canChat ? "ready" : ""}`} />
                    {savedKey
                      ? `Saved key ending ${savedKey.keyHint} — encrypted on the server`
                      : apiKey
                      ? "Will be used for this request only unless you save it"
                      : "No key configured"}
                  </div>

                  {providerKeys.length > 0 && (
                    <div className="key-saved-list">
                      {providerKeys.map((entry) => (
                        <div key={entry.provider} className="key-saved-item">
                          <span>
                            {entry.provider} · ending {entry.keyHint}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              removeProviderKey(entry.provider as Provider)
                            }
                            aria-label={`Remove the saved ${entry.provider} key`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </aside>
            </div>
          ) : view === "favorites" ? (
            <section className="card favorites-card">
              <div className="section-heading favorites-heading">
                <div>
                  <div className="eyebrow">Your positive feedback loop</div>
                  <h2>Favorite recipes</h2>
                  <p>
                    Saved recipes become strong signals for future plans. Harvest
                    can reuse them as-is or adapt them to current targets and pantry.
                  </p>
                </div>
              </div>
              {favorites.length > 0 ? (
                <div className="favorites-grid">
                  {favorites.map((favorite) => (
                    <article className="favorite-card" key={favorite.id}>
                      <button
                        className="favorite-open"
                        onClick={() => {
                          setFeedbackNotice("");
                          setSelectedMeal(favorite.recipe);
                        }}
                      >
                        <div className="meal-meta">
                          {favorite.recipe.mealType}
                        </div>
                        <h3>{favorite.recipe.name}</h3>
                        <p>{favorite.recipe.description}</p>
                        <div className="favorite-stats">
                          <span>
                            <Clock3 size={13} />
                            {favorite.recipe.prepMinutes +
                              favorite.recipe.cookMinutes}{" "}
                            min
                          </span>
                          <span>
                            <Utensils size={13} />
                            Made {favorite.cookedCount}{" "}
                            {favorite.cookedCount === 1 ? "time" : "times"}
                          </span>
                        </div>
                      </button>
                      <div className="favorite-actions">
                        <button onClick={() => useFavoriteAgain(favorite)}>
                          <RefreshCw size={13} /> Use again
                        </button>
                        <button
                          className="favorite-remove"
                          onClick={() => void toggleFavorite(favorite.recipe)}
                        >
                          <Trash2 size={13} /> Remove
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="pantry-empty">
                  <Heart size={36} />
                  <h3>No favorites yet</h3>
                  <p>
                    Open any recipe from “My week” and tap “Favorite” to teach
                    Harvest what you would happily eat again.
                  </p>
                  <button className="primary-button" onClick={() => setView("plan")}>
                    Browse this week
                  </button>
                </div>
              )}
            </section>
          ) : view === "pantry" ? (
            <section className="card pantry-card">
              <div className="section-heading pantry-heading">
                <div>
                  <h2>Your kitchen inventory</h2>
                  <p>
                    Tell Harvest what you buy, finish, or already have. It will
                    prioritize these ingredients and shop only for what is missing.
                  </p>
                </div>
                <button className="primary-button" onClick={describePantry}>
                  <MessageCircle size={17} /> Update through chat
                </button>
              </div>
              {pantry.length > 0 ? (
                <div className="pantry-grid">
                  {pantry.map((item) => (
                    <article className="pantry-item" key={item.name.toLocaleLowerCase()}>
                      <div className="pantry-item-copy">
                        <div className="pantry-category">{item.category}</div>
                        <h3>{item.name}</h3>
                        <p>
                          {item.quantity}
                          {item.expiresAt ? ` · use by ${item.expiresAt}` : ""}
                        </p>
                      </div>
                      <button
                        className="pantry-remove"
                        onClick={() => void removePantryItem(item.name)}
                        aria-label={`Remove ${item.name}`}
                      >
                        Remove
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="pantry-empty">
                  <PackageOpen size={36} />
                  <h3>What is already in your kitchen?</h3>
                  <p>
                    Try “I have six eggs, half a bag of spinach, rice, and two
                    chicken breasts.”
                  </p>
                  <button className="primary-button" onClick={describePantry}>
                    Tell Harvest
                  </button>
                </div>
              )}
            </section>
          ) : view === "shopping" ? (
            plan ? (
              <section className="card shopping-card">
                <div className="section-heading shopping-heading">
                  <div>
                    <div className="eyebrow">Pantry-aware shopping list</div>
                    <h2>What you still need to buy</h2>
                    <p>
                      These are the remaining ingredients for {plan.title} after
                      accounting for what you told Harvest is already on hand.
                    </p>
                  </div>
                  <div className="shopping-actions">
                    <button
                      className="clear-button"
                      type="button"
                      onClick={() => void copyShoppingList()}
                      disabled={shoppingEntries.length === 0}
                    >
                      {shoppingCopied ? (
                        <Check size={14} />
                      ) : (
                        <ClipboardCopy size={14} />
                      )}
                      {shoppingCopied ? "Copied" : "Copy list"}
                    </button>
                    {checkedShoppingCount > 0 && (
                      <button
                        className="clear-button"
                        type="button"
                        onClick={clearShoppingChecks}
                      >
                        Clear checks
                      </button>
                    )}
                  </div>
                </div>
                {shoppingEntries.length > 0 ? (
                  <>
                    <div className="shopping-progress">
                      <div>
                        <strong>
                          {shoppingEntries.length - checkedShoppingCount}
                        </strong>{" "}
                        left to buy
                      </div>
                      <span>
                        {checkedShoppingCount} of {shoppingEntries.length} checked
                      </span>
                      <div className="shopping-progress-track">
                        <span
                          style={{
                            width: `${
                              (checkedShoppingCount / shoppingEntries.length) * 100
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="shopping-groups">
                      {plan.shoppingList
                        .filter((group) => group.items.length > 0)
                        .map((group) => (
                          <section key={group.category}>
                            <h3>{group.category}</h3>
                            <div>
                              {group.items.map((item) => {
                                const key = `${group.category}::${item.name}::${item.quantity}`;
                                const checked = checkedShoppingSet.has(key);
                                return (
                                  <label
                                    className={`shopping-item ${
                                      checked ? "checked" : ""
                                    }`}
                                    key={key}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleShoppingItem(key)}
                                    />
                                    <span className="shopping-check">
                                      {checked && <Check size={13} />}
                                    </span>
                                    <span className="shopping-item-name">
                                      {item.name}
                                    </span>
                                    <strong>{item.quantity}</strong>
                                  </label>
                                );
                              })}
                            </div>
                          </section>
                        ))}
                    </div>
                    <div className="shopping-note">
                      <PackageOpen size={18} />
                      <p>
                        If something listed here is already at home, update “On
                        hand” through chat before regenerating the plan so future
                        quantities account for it.
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="pantry-empty">
                    <Check size={36} />
                    <h3>Nothing else to buy</h3>
                    <p>Your current plan is fully covered by your pantry.</p>
                  </div>
                )}
              </section>
            ) : (
              <section className="card plan-empty">
                <ShoppingCart size={34} />
                <h2>No shopping list yet</h2>
                <p>Create a meal plan and Harvest will calculate what is missing.</p>
                <button
                  className="primary-button"
                  onClick={() => {
                    setMessage(
                      "Create a meal plan based on my saved preferences and what I have on hand."
                    );
                    setView("chat");
                  }}
                >
                  <Sparkles size={17} /> Create plan
                </button>
              </section>
            )
          ) : view === "preferences" ? (
            <form className="card form-card" onSubmit={savePreferenceForm}>
              <div className="section-heading">
                <div>
                  <h2>Your preference profile</h2>
                  <p>
                    Edit it directly or teach Harvest through chat. You remain in
                    control of its memory.
                  </p>
                </div>
              </div>
              <div className="form-grid">
                <PreferenceField label="Dietary style">
                  <input
                    className="input"
                    value={preferences.dietaryStyle}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        dietaryStyle: event.target.value,
                      })
                    }
                  />
                </PreferenceField>
                <PreferenceField label="Household size">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={30}
                    value={preferences.householdSize}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        householdSize: Number(event.target.value),
                      })
                    }
                  />
                </PreferenceField>
                <PreferenceField label="Allergies (comma separated)">
                  <input
                    className="input"
                    value={preferences.allergies.join(", ")}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        allergies: commaList(event.target.value),
                      })
                    }
                  />
                </PreferenceField>
                <PreferenceField label="Disliked ingredients">
                  <input
                    className="input"
                    value={preferences.dislikedIngredients.join(", ")}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        dislikedIngredients: commaList(event.target.value),
                      })
                    }
                  />
                </PreferenceField>
                <PreferenceField label="Health and nutrition goals">
                  <input
                    className="input"
                    value={preferences.healthGoals.join(", ")}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        healthGoals: commaList(event.target.value),
                      })
                    }
                  />
                </PreferenceField>
                <PreferenceField label="Preferred cuisines">
                  <input
                    className="input"
                    value={preferences.preferredCuisines.join(", ")}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        preferredCuisines: commaList(event.target.value),
                      })
                    }
                  />
                </PreferenceField>
                <PreferenceField label="Weekly budget">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={preferences.weeklyBudget ?? ""}
                    placeholder="No fixed budget"
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        weeklyBudget: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  />
                </PreferenceField>
                <PreferenceField label="Maximum cooking time">
                  <input
                    className="input"
                    type="number"
                    min={5}
                    value={preferences.maxCookingMinutes}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        maxCookingMinutes: Number(event.target.value),
                      })
                    }
                  />
                </PreferenceField>
                <PreferenceField label="Kitchen equipment">
                  <input
                    className="input"
                    value={preferences.equipment.join(", ")}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        equipment: commaList(event.target.value),
                      })
                    }
                  />
                </PreferenceField>
                <PreferenceField label="Planning days">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={31}
                    value={preferences.planningDays}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        planningDays: Number(event.target.value),
                      })
                    }
                  />
                  <p className="field-help">
                    Used when chat does not specify a length. You can also ask for
                    an exact length, such as “create a 10-day plan.”
                  </p>
                </PreferenceField>
                <PreferenceField label="Eating occasions per day">
                  <select
                    value={preferences.mealsPerDay ?? ""}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        mealsPerDay: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  >
                    <option value="">Automatic — coach decides</option>
                    {Array.from({ length: 8 }, (_, index) => index + 1).map(
                      (count) => (
                        <option value={count} key={count}>
                          {count} per day
                        </option>
                      )
                    )}
                  </select>
                  <p className="field-help">
                    Automatic may vary by day and can include meals or snacks.
                    Choose a number only when it is a firm preference.
                  </p>
                </PreferenceField>
                <PreferenceField label="Timezone">
                  <div className="timezone-field">
                    <input
                      className="input"
                      list="timezone-options"
                      value={preferences.timezone}
                      onChange={(event) =>
                        setPreferences({
                          ...preferences,
                          timezone: event.target.value,
                        })
                      }
                      placeholder="America/Toronto"
                    />
                    <button type="button" onClick={useBrowserTimezone}>
                      Use browser
                    </button>
                  </div>
                  <datalist id="timezone-options">
                    {COMMON_TIMEZONES.map((timezone) => (
                      <option value={timezone} key={timezone} />
                    ))}
                  </datalist>
                </PreferenceField>
                <PreferenceField label="Adult body profile for coaching" wide>
                  <div className="body-profile-grid">
                    <label>
                      <span>Age</span>
                      <input
                        className="input"
                        type="number"
                        min={18}
                        max={100}
                        value={preferences.bodyProfile.ageYears ?? ""}
                        onChange={(event) =>
                          updateBodyProfile({
                            ageYears: optionalNumber(event.target.value),
                          })
                        }
                        placeholder="Years"
                      />
                    </label>
                    <label>
                      <span>Equation sex input</span>
                      <select
                        value={preferences.bodyProfile.sexForEquation}
                        onChange={(event) =>
                          updateBodyProfile({
                            sexForEquation: event.target.value as
                              | "female"
                              | "male"
                              | "unspecified",
                          })
                        }
                      >
                        <option value="unspecified">Not set</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                      </select>
                    </label>
                    <label>
                      <span>Height</span>
                      <input
                        className="input"
                        type="number"
                        min={100}
                        max={250}
                        value={preferences.bodyProfile.heightCm ?? ""}
                        onChange={(event) =>
                          updateBodyProfile({
                            heightCm: optionalNumber(event.target.value),
                          })
                        }
                        placeholder="cm"
                      />
                    </label>
                    <label>
                      <span>Current weight</span>
                      <input
                        className="input"
                        type="number"
                        min={25}
                        max={500}
                        step="0.1"
                        value={preferences.bodyProfile.weightKg ?? ""}
                        onChange={(event) =>
                          updateBodyProfile({
                            weightKg: optionalNumber(event.target.value),
                          })
                        }
                        placeholder="kg"
                      />
                    </label>
                    <label>
                      <span>Goal weight</span>
                      <input
                        className="input"
                        type="number"
                        min={25}
                        max={500}
                        step="0.1"
                        value={preferences.bodyProfile.goalWeightKg ?? ""}
                        onChange={(event) =>
                          updateBodyProfile({
                            goalWeightKg: optionalNumber(event.target.value),
                          })
                        }
                        placeholder="kg"
                      />
                    </label>
                    <label>
                      <span>Goal pace</span>
                      <input
                        className="input"
                        type="number"
                        min={0.1}
                        max={0.9}
                        step="0.1"
                        value={preferences.bodyProfile.goalPaceKgPerWeek ?? ""}
                        onChange={(event) =>
                          updateBodyProfile({
                            goalPaceKgPerWeek: optionalNumber(event.target.value),
                          })
                        }
                        placeholder="kg/week"
                      />
                    </label>
                    <label>
                      <span>Activity</span>
                      <select
                        value={preferences.bodyProfile.activityLevel}
                        onChange={(event) =>
                          updateBodyProfile({
                            activityLevel: event.target.value as
                              UserPreferences["bodyProfile"]["activityLevel"],
                          })
                        }
                      >
                        <option value="sedentary">Mostly sedentary</option>
                        <option value="lightly_active">Lightly active</option>
                        <option value="moderately_active">Moderately active</option>
                        <option value="very_active">Very active</option>
                        <option value="extra_active">Extra active</option>
                      </select>
                    </label>
                  </div>
                  <p className="field-help">
                    Used for adult screening estimates only. You can also share
                    these values naturally in chat; lb and ft/in values will be
                    converted to metric storage.
                  </p>
                </PreferenceField>
                <PreferenceField label="Daily schedule and meal timing" wide>
                  <div className="schedule-grid">
                    {[
                      ["wakeTime", "Wake time"],
                      ["breakfastTime", "Breakfast"],
                      ["lunchTime", "Lunch"],
                      ["dinnerTime", "Dinner"],
                      ["workoutTime", "Workout"],
                      ["sleepTime", "Sleep time"],
                    ].map(([key, label]) => (
                      <label key={key}>
                        <span>{label}</span>
                        <input
                          className="input"
                          type="time"
                          value={
                            preferences.mealSchedule[
                              key as keyof Omit<
                                UserPreferences["mealSchedule"],
                                "scheduleNotes"
                              >
                            ] ?? ""
                          }
                          onChange={(event) =>
                            updateMealSchedule({
                              [key]: event.target.value || null,
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <textarea
                    className="schedule-notes"
                    rows={2}
                    value={preferences.mealSchedule.scheduleNotes}
                    onChange={(event) =>
                      updateMealSchedule({ scheduleNotes: event.target.value })
                    }
                    placeholder="Optional: work shifts, commute, training days, reflux, medication timing prescribed by your clinician, or when hunger is strongest."
                  />
                  <p className="field-help">
                    Times use your selected timezone. Leave fields blank when
                    flexible; Harvest will mark generated times as adjustable.
                  </p>
                </PreferenceField>
                <PreferenceField label="Daily macro targets (optional)" wide>
                  <div className="macro-target-grid">
                    {MACROS.map((macro) => (
                      <label key={macro.key}>
                        <span>{macro.label}</span>
                        <div>
                          <input
                            className="input"
                            type="number"
                            min={1}
                            value={preferences.macroTargets[macro.key] ?? ""}
                            placeholder="Not set"
                            onChange={(event) =>
                              setPreferences({
                                ...preferences,
                                macroTargets: {
                                  ...preferences.macroTargets,
                                  [macro.key]: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                },
                              })
                            }
                          />
                          <small>{macro.unit}</small>
                        </div>
                      </label>
                    ))}
                  </div>
                </PreferenceField>
                <PreferenceField label="Anything else" wide>
                  <textarea
                    rows={4}
                    value={preferences.notes}
                    onChange={(event) =>
                      setPreferences({
                        ...preferences,
                        notes: event.target.value,
                      })
                    }
                  />
                </PreferenceField>
              </div>
              {coaching && (
                <section className="coaching-summary">
                  <div>
                    <div className="eyebrow">Saved coaching estimate</div>
                    <h3>Your planning baseline</h3>
                  </div>
                  <div className="coaching-metrics">
                    <CoachingMetric
                      label="BMI"
                      value={
                        coaching.bmi === null
                          ? "Incomplete"
                          : `${coaching.bmi} · ${coaching.bmiCategory}`
                      }
                    />
                    <CoachingMetric
                      label="Resting estimate"
                      value={
                        coaching.restingCalories === null
                          ? "Incomplete"
                          : `${coaching.restingCalories} kcal/day`
                      }
                    />
                    <CoachingMetric
                      label="Maintenance estimate"
                      value={
                        coaching.maintenanceCalories === null
                          ? "Incomplete"
                          : `${coaching.maintenanceCalories} kcal/day`
                      }
                    />
                    <CoachingMetric
                      label="Goal estimate"
                      value={
                        coaching.goalCalories === null
                          ? "Incomplete"
                          : `${coaching.goalCalories} kcal/day`
                      }
                    />
                  </div>
                  <p>{coaching.method}. {coaching.warnings.join(" ")}</p>
                </section>
              )}
              <div className="form-actions">
                <button className="primary-button" disabled={saving}>
                  {saving && <LoaderCircle size={16} />} Save preferences
                </button>
                {saved && <span className="saved">Saved</span>}
              </div>
            </form>
          ) : plan ? (
            <section className="card week-plan">
              <div className="plan-header">
                <div className="plan-header-row">
                  <div>
                    <div className="eyebrow">
                      Starting {formatPlanDate(plan.startDate, preferences.timezone)}
                    </div>
                    <h2>{plan.title}</h2>
                  </div>
                  <div className="plan-actions">
                    <button
                      className="revise-button"
                      onClick={() => setShowPlanHistory((current) => !current)}
                    >
                      <History size={14} />
                      History
                    </button>
                    <button
                      className="revise-button"
                      onClick={reviseWholePlan}
                    >
                      <RefreshCw size={14} />
                      Revise whole plan
                    </button>
                    <button
                      className="clear-button"
                      onClick={() => void clearPlan()}
                      disabled={clearingPlan}
                    >
                      {clearingPlan ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                      Clear plan
                    </button>
                  </div>
                </div>
                <p>{plan.rationale}</p>
                {plan.timingRationale && (
                  <div className="timing-rationale">
                    <Clock3 size={16} />
                    <div>
                      <strong>Why these meal times</strong>
                      <span>{plan.timingRationale}</span>
                    </div>
                  </div>
                )}
                <div className="plan-timezone">
                  <Clock3 size={13} /> Dates and times use {preferences.timezone}
                </div>
              </div>
              {showPlanHistory && (
                <div className="plan-history">
                  <div className="plan-history-heading">
                    <div>
                      <div className="eyebrow">Safe iteration</div>
                      <h3>Plan history</h3>
                    </div>
                    <span>Restoring creates a new version; nothing is deleted.</span>
                  </div>
                  <div className="plan-history-list">
                    {planVersions
                      .filter((version) => version.status !== "active")
                      .slice(0, 8)
                      .map((version) => (
                        <article key={version.id}>
                          <div>
                            <strong>{version.title}</strong>
                            <span>
                              {version.plan.meals.length} eating occasions ·{" "}
                              {new Date(version.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <button
                            className="revise-button"
                            disabled={restoringVersion === version.id}
                            onClick={() => void restoreVersion(version)}
                          >
                            {restoringVersion === version.id ? (
                              <LoaderCircle size={13} className="spin" />
                            ) : (
                              <History size={13} />
                            )}
                            Restore
                          </button>
                        </article>
                      ))}
                    {planVersions.filter(
                      (version) => version.status !== "active"
                    ).length === 0 && (
                      <p className="plan-history-empty">
                        Earlier versions will appear after the first revision.
                      </p>
                    )}
                  </div>
                </div>
              )}
              {focusDay && (
                <div className="today-dashboard">
                  <div className="today-heading">
                    <div>
                      <div className="eyebrow">
                        {focusDay.date === localClock.date
                          ? "Today"
                          : "Next planned day"}
                      </div>
                      <h3>
                        {focusDay.date
                          ? formatPlanDate(
                              focusDay.date,
                              preferences.timezone
                            )
                          : focusDay.day}
                      </h3>
                    </div>
                    <span>{focusMeals.length} eating occasions planned</span>
                  </div>
                  <div className="today-grid">
                    <article className="next-meal-card">
                      <div>
                        <span>Next up</span>
                        <strong>
                          {nextMeal
                            ? `${nextMeal.time ? `${nextMeal.time} · ` : ""}${
                                nextMeal.name
                              }`
                            : "No meal scheduled"}
                        </strong>
                      </div>
                      {nextMeal && (
                        <button
                          className="revise-button"
                          onClick={() => {
                            setFeedbackNotice("");
                            setSelectedMeal(nextMeal);
                          }}
                        >
                          Open recipe
                        </button>
                      )}
                    </article>
                    <article>
                      <span>Prep requiring attention</span>
                      <strong>{urgentPrep.length}</strong>
                      <small>
                        {urgentPrep.length > 0
                          ? urgentPrep
                              .slice(0, 2)
                              .map((task) => task.title)
                              .join(" · ")
                          : "Nothing due now"}
                      </small>
                    </article>
                    <article>
                      <span>Still to buy</span>
                      <strong>
                        {shoppingEntries.length - checkedShoppingCount}
                      </strong>
                      <button
                        className="text-button"
                        onClick={() => setView("shopping")}
                      >
                        Open shopping list
                      </button>
                    </article>
                  </div>
                </div>
              )}
              <div className="plan-checks">
                <div className="plan-checks-heading">
                  <div>
                    <div className="eyebrow">Automatic plan checks</div>
                    <h3>Quality at a glance</h3>
                  </div>
                  <span>Deterministic checks—not another AI opinion</span>
                </div>
                <div className="plan-check-grid">
                  <article>
                    <strong>{weekDays.length}</strong>
                    <span>Calendar days</span>
                    <small>{plan.meals.length} total eating occasions</small>
                  </article>
                  <article>
                    <strong>
                      {macroCompleteMeals}/{plan.meals.length}
                    </strong>
                    <span>Macro-complete meals</span>
                    <small>
                      {macroCompleteMeals === plan.meals.length
                        ? "Every meal is measurable"
                        : "Some nutrition estimates are missing"}
                    </small>
                  </article>
                  <article>
                    <strong>
                      {uniqueMealCount}/{plan.meals.length}
                    </strong>
                    <span>Unique meals</span>
                    <small>
                      {plan.meals.length - uniqueMealCount === 0
                        ? "No exact repeats"
                        : `${plan.meals.length - uniqueMealCount} planned repeats`}
                    </small>
                  </article>
                  <article>
                    <strong>
                      {calorieAlignment === null
                        ? "—"
                        : `${calorieAlignment}%`}
                    </strong>
                    <span>Calorie target alignment</span>
                    <small>
                      {calorieAlignment === null
                        ? "Set a profile or target to compare"
                        : "Daily plan average ÷ target"}
                    </small>
                  </article>
                </div>
              </div>
              <div className="macro-overview">
                <div className="macro-overview-heading">
                  <div>
                    <div className="eyebrow">Macro overview</div>
                    <h3>Daily averages per person</h3>
                  </div>
                  <div className="macro-overview-actions">
                    <span>
                      {coaching?.goalCalories
                        ? `Coaching estimate: ${coaching.goalCalories} kcal/day`
                        : "Estimated from every planned meal"}
                    </span>
                    <button
                      type="button"
                      className="revise-button"
                      onClick={rebalancePlanMacros}
                    >
                      <RefreshCw size={13} />
                      Rebalance macros
                    </button>
                  </div>
                </div>
                <div className="macro-summary-grid">
                  {MACROS.map((macro) => {
                    const explicitTarget =
                      preferences.macroTargets[macro.key];
                    const target =
                      explicitTarget ??
                      (macro.key === "calories"
                        ? coaching?.goalCalories ?? null
                        : null);
                    const dailyValue =
                      planMacroSummary.daily[macro.key];
                    const difference =
                      target !== null && dailyValue !== null
                        ? dailyValue - target
                        : null;
                    const withinTarget =
                      target !== null && dailyValue !== null
                        ? isMacroWithinTarget(
                            macro.key,
                            dailyValue,
                            target
                          )
                        : null;
                    return (
                    <article key={macro.key}>
                      <strong>
                        {formatMacro(
                          dailyValue,
                          macro.unit
                        )}
                      </strong>
                      <span>{macro.label}</span>
                      <small>
                        {formatMacro(
                          planMacroSummary.total[macro.key],
                          macro.unit
                        )}{" "}
                        plan total
                      </small>
                      {target !== null && (
                        <>
                          <small className="macro-target">
                            Target {formatMacro(target, macro.unit)}/day
                          </small>
                          {difference !== null && (
                            <small
                              className={`macro-variance ${
                                withinTarget ? "aligned" : "outside"
                              }`}
                            >
                              {difference > 0 ? "+" : ""}
                              {formatMacro(difference, macro.unit)} from target
                            </small>
                          )}
                        </>
                      )}
                    </article>
                    );
                  })}
                </div>
              </div>
              {advancePrep.length > 0 && (
                <div className="prep-alert">
                  <div className="prep-alert-heading">
                    <CalendarClock size={21} />
                    <div>
                      <strong>Prepare ahead</strong>
                      <span>Scheduled in {preferences.timezone}</span>
                    </div>
                  </div>
                  <div className="prep-timeline">
                    {advancePrep.map((task, index) => (
                      <article key={`${task.date}-${task.title}-${index}`}>
                        <time>
                          {formatPlanDate(task.date, preferences.timezone)}
                          {task.time ? ` · ${task.time}` : ""}
                        </time>
                        <div>
                          <strong>
                            {task.title}
                            {getPrepUrgency(task.date, task.time, preferences.timezone) && (
                              <em>
                                {getPrepUrgency(task.date, task.time, preferences.timezone)}
                              </em>
                            )}
                          </strong>
                          <span>For {task.forMeal}</span>
                          <p>{task.instructions}</p>
                        </div>
                        <small>
                          {task.durationMinutes} min active
                          {typeof task.leadTimeHours === "number" &&
                          task.leadTimeHours > 0
                            ? ` · start ${task.leadTimeHours}h ahead`
                            : ""}
                        </small>
                      </article>
                    ))}
                  </div>
                </div>
              )}
              <div className="week-board">
                {weekDays.map((group) => {
                  const dayMacros = summarizeMacros(group.meals, 1);
                  const activeDayTargets = MACROS.filter(
                    (macro) =>
                      preferences.macroTargets[macro.key] !== null
                  );
                  const alignedDayTargets = activeDayTargets.filter((macro) => {
                    const actual = dayMacros.total[macro.key];
                    const target = preferences.macroTargets[macro.key];
                    return (
                      actual !== null &&
                      target !== null &&
                      isMacroWithinTarget(macro.key, actual, target)
                    );
                  }).length;
                  return (
                  <section className="day-column" key={group.date || group.day}>
                    <header>
                      <div className="day-heading-row">
                        <div>
                          <div className="day-name">{group.day}</div>
                          {group.date && (
                            <time>{formatPlanDate(group.date, preferences.timezone, true)}</time>
                          )}
                        </div>
                        <button
                          type="button"
                          className="day-revise"
                          onClick={() => reviseDay(group)}
                          aria-label={`Revise meals for ${group.day}`}
                          title={`Revise ${group.day}`}
                        >
                          <RefreshCw size={13} />
                        </button>
                      </div>
                      <div className="day-macros">
                        <span>{formatMacro(dayMacros.total.calories, "kcal")}</span>
                        <span>{formatMacro(dayMacros.total.proteinGrams, "g")} protein</span>
                        <span>{formatMacro(dayMacros.total.carbohydrateGrams, "g")} carbs</span>
                        <span>{formatMacro(dayMacros.total.fatGrams, "g")} fat</span>
                        <span>{formatMacro(dayMacros.total.fiberGrams, "g")} fiber</span>
                        {activeDayTargets.length > 0 && (
                          <span
                            className={
                              alignedDayTargets === activeDayTargets.length
                                ? "day-targets-aligned"
                                : "day-targets-outside"
                            }
                          >
                            {alignedDayTargets}/{activeDayTargets.length} targets
                          </span>
                        )}
                      </div>
                    </header>
                    <div className="day-meals">
                      {group.meals.map((meal, index) => (
                        <button
                          className="meal-card"
                          key={`${meal.mealType}-${meal.name}-${index}`}
                          onClick={() => {
                            setFeedbackNotice("");
                            setSelectedMeal(meal);
                          }}
                        >
                          <div className="meal-meta">
                            {meal.mealType}
                            {meal.time ? ` · ${meal.time}` : ""}
                          </div>
                          <h3>{meal.name}</h3>
                          <p>{meal.description}</p>
                          <div className="meal-card-footer">
                            <span>
                              <Clock3 size={13} />
                              {meal.prepMinutes + meal.cookMinutes} min
                            </span>
                            <span>{meal.servings} servings</span>
                          </div>
                          <span className="open-recipe">View recipe →</span>
                        </button>
                      ))}
                    </div>
                  </section>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="card plan-empty">
              <CalendarDays size={34} />
              <h2>Your week is an open canvas</h2>
              <p>Ask the AI planner to create a week around your real life.</p>
              <button
                className="primary-button"
                onClick={() => {
                  setMessage("Create a meal plan based on my saved preferences and pantry.");
                  setView("chat");
                }}
              >
                <Sparkles size={17} /> Plan with AI
              </button>
            </section>
          )}
        </div>
      </main>

      <nav className="mobile-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {selectedMeal && (
        <div
          className="recipe-overlay"
          role="presentation"
          onMouseDown={() => setSelectedMeal(null)}
        >
          <article
            className="recipe-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recipe-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              className="recipe-close"
              onClick={() => setSelectedMeal(null)}
              aria-label="Close recipe"
            >
              <X size={20} />
            </button>
            <div className="eyebrow">
              {selectedMeal.day} · {selectedMeal.mealType}
              {selectedMeal.time ? ` · ${selectedMeal.time}` : ""}
            </div>
            <h2 id="recipe-title">{selectedMeal.name}</h2>
            <p className="recipe-description">{selectedMeal.description}</p>
            <div className="recipe-facts">
              <span><Clock3 size={15} /> {selectedMeal.prepMinutes} min prep</span>
              <span>{selectedMeal.cookMinutes} min cooking</span>
              <span>{selectedMeal.servings} servings</span>
              {selectedMeal.nutrition.calories !== null && (
                <span>{selectedMeal.nutrition.calories} kcal</span>
              )}
              {selectedMeal.nutrition.proteinGrams !== null && (
                <span>{selectedMeal.nutrition.proteinGrams}g protein</span>
              )}
              {selectedMeal.nutrition.carbohydrateGrams != null && (
                <span>{selectedMeal.nutrition.carbohydrateGrams}g carbs</span>
              )}
              {selectedMeal.nutrition.fatGrams != null && (
                <span>{selectedMeal.nutrition.fatGrams}g fat</span>
              )}
              {selectedMeal.nutrition.fiberGrams !== null && (
                <span>{selectedMeal.nutrition.fiberGrams}g fiber</span>
              )}
            </div>
            <div className="recipe-feedback-actions">
              <button
                className={`favorite-button ${
                  favoriteForMeal(selectedMeal) ? "active" : ""
                }`}
                disabled={feedbackSaving}
                onClick={() => void toggleFavorite(selectedMeal)}
              >
                <Heart
                  size={16}
                  fill={favoriteForMeal(selectedMeal) ? "currentColor" : "none"}
                />
                {favoriteForMeal(selectedMeal) ? "Favorited" : "Favorite"}
              </button>
              <button
                disabled={feedbackSaving}
                onClick={() => void recordMealFeedback(selectedMeal, "cooked")}
              >
                <Utensils size={16} /> Made it
              </button>
              <button
                disabled={feedbackSaving}
                onClick={() =>
                  void recordMealFeedback(selectedMeal, "not_for_me")
                }
              >
                <ThumbsDown size={16} /> Not for me
              </button>
              <button
                className="primary-button"
                onClick={() => reviseMeal(selectedMeal)}
                disabled={revising}
              >
                <RefreshCw size={16} /> Revise this meal
              </button>
            </div>
            {feedbackNotice && (
              <div className="feedback-notice">{feedbackNotice}</div>
            )}
            <div className="recipe-content">
              <section>
                <h3><ChefHat size={18} /> Ingredients</h3>
                <ul className="ingredient-list">
                  {selectedMeal.ingredients.map((ingredient, index) => (
                    <li key={`${ingredient.name}-${index}`}>
                      <div>
                        <span>{ingredient.name}</span>
                        {(ingredient.form || ingredient.preparation) && (
                          <small>
                            {[ingredient.form, ingredient.preparation]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        )}
                      </div>
                      <strong>{ingredient.quantity}</strong>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>Method</h3>
                <ol className="instruction-list">
                  {selectedMeal.instructions.map((instruction, index) => (
                    <li key={index}>
                      <span>{index + 1}</span>
                      <p>{instruction}</p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
            {(selectedMeal.donenessCues ||
              selectedMeal.storageInstructions) && (
              <div className="recipe-guidance">
                {selectedMeal.donenessCues && (
                  <article>
                    <strong>How to know it is ready</strong>
                    <p>{selectedMeal.donenessCues}</p>
                  </article>
                )}
                {selectedMeal.storageInstructions && (
                  <article>
                    <strong>Storage and reheating</strong>
                    <p>{selectedMeal.storageInstructions}</p>
                  </article>
                )}
              </div>
            )}
          </article>
        </div>
      )}
    </div>
  );
}

function summarizeMacros(
  meals: PlannedMeal[],
  days: number
): {
  total: Record<MacroKey, number | null>;
  daily: Record<MacroKey, number | null>;
} {
  const total = {} as Record<MacroKey, number | null>;
  const daily = {} as Record<MacroKey, number | null>;

  for (const macro of MACROS) {
    const values = meals
      .map((meal) => meal.nutrition[macro.key])
      .filter((value): value is number => typeof value === "number");
    total[macro.key] =
      values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
    daily[macro.key] =
      total[macro.key] === null
        ? null
        : Math.round((total[macro.key] as number) / Math.max(days, 1));
  }

  return { total, daily };
}

function formatMacro(value: number | null, unit: string): string {
  if (value === null) return "—";
  const rounded = Math.round(value);
  return unit === "g" ? `${rounded}g` : `${rounded} ${unit}`;
}

function isMacroWithinTarget(
  key: MacroKey,
  actual: number,
  target: number
): boolean {
  const lowerRatio = key === "calories" ? 0.95 : 0.9;
  const upperRatio =
    key === "calories" ? 1.05 : key === "fiberGrams" ? 1.25 : 1.1;
  return actual >= target * lowerRatio && actual <= target * upperRatio;
}

function formatPlanDate(
  value: string,
  _timezone: string,
  short = false
): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    month: short ? "short" : "long",
    day: "numeric",
    year: short ? undefined : "numeric",
  }).format(date);
}

function getLocalClock(timezone: string): { date: string; time: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return {
      date: `${value("year")}-${value("month")}-${value("day")}`,
      time: `${value("hour")}:${value("minute")}`,
    };
  } catch {
    const now = new Date();
    return {
      date: now.toISOString().slice(0, 10),
      time: now.toISOString().slice(11, 16),
    };
  }
}

function getPrepUrgency(
  date: string,
  time: string,
  timezone: string
): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    const today = `${value("year")}-${value("month")}-${value("day")}`;
    const now = `${today}T${value("hour")}:${value("minute")}`;
    const due = `${date}T${time}`;
    if (due <= now) return "Due now";
    if (date === today) return "Today";
    return null;
  } catch {
    return null;
  }
}

function PreferenceField({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`field ${wide ? "wide" : ""}`}>
      <label>{label}</label>
      {children}
    </div>
  );
}

function CoachingMetric({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
