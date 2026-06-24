import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "EN" | "PL";

export type Translations = {
  // App header / progress
  darkMode: string;
  downloadInProgress: string;
  detectingObjects: string;
  detectingObjectsProgress: (completed: number, total: number) => string;
  processingImages: (completed: number, total: number) => string;

  // Accessibility labels
  close: string;
  homeLabel: string;
  selectLanguage: string;
  imagePreviewLabel: string;

  // DropZone
  dropFilesHere: string;
  dragPhotosHere: string;
  supportedFormats: string;

  // Image list
  uploadedImages: (count: number) => string;
  typeToFilter: string;
  process: string;
  preview: string;
  clear: string;
  detect: string;
  detectionFailed: (error: string) => string;
  noFilesMatch: string;
  dimensionsLoading: string;

  // Review
  noImagesToReview: string;
  pleaseCheckImages: (indices: string) => string;
  imageOf: (index: number, total: number) => string;
  generateData: string;
  edit: string;
  backToEditTitle: string;
  backToEditMessage: string;
  resetTitle: string;
  resetMessage: string;
  reset: string;
  delete: string;
  files: string;
  loadingImage: string;
  processingPoints: string;
  errorMsg: (msg: string) => string;
  points: string;
  previous: string;
  next: string;
  imageMetadata: string;
  csv: string;
  selectAtLeastOne: string;
  cancel: string;
  download: string;
  dimensionsPx: (w: number, h: number) => string;

  // Detection model panel
  detectionModel: string;
  statusReady: string;
  statusLoading: string;
  checking: string;
  loadModel: string;
  loadingModel: string;
  modelReady: string;
  reloadModel: string;
  tryAgain: string;

  // Image preview modal
  imagePreviewOf: (index: number, total: number) => string;
  unknownType: string;
  boundingBoxOn: string;
  boundingBoxOff: string;
  boundingBoxesOn: string;
  boundingBoxesOff: string;
  confidenceOn: string;
  confidenceOff: string;
  extractWings: string;
  skipProcessing: string;
  processImage: string;
  flipHorizontal: string;
  flipVertical: string;
  rotateCw: string;
  rotateCcw: string;

  // Help panel
  help: string;
  howToUse: string;
  workflowLabel: string;
  keyboardShortcutsLabel: string;
  steps: { step: string; detail: string }[];
  shortcuts: { context: string; rows: { keys: string[]; description: string }[] }[];
};

const en: Translations = {
  darkMode: "Dark mode",
  downloadInProgress: "Download in progress...",
  detectingObjects: "Detecting objects...",
  detectingObjectsProgress: (c, t) => `Detecting objects... ${c}/${t}`,
  processingImages: (c, t) => `Processing images... ${c}/${t}`,

  close: "Close",
  homeLabel: "WingAI home",
  selectLanguage: "Select language",
  imagePreviewLabel: "Image preview",

  dropFilesHere: "Drop files here...",
  dragPhotosHere: "Drag photos here or click to select",
  supportedFormats: "Supported formats: .png, .jpg",

  uploadedImages: (n) => `Uploaded ${n} ${n === 1 ? "image" : "images"}:`,
  typeToFilter: "Type to filter...",
  process: "Process",
  preview: "Preview",
  clear: "Clear",
  detect: "Detect",
  detectionFailed: (e) => `Detection failed: ${e}`,
  noFilesMatch: "No files match the current filter.",
  dimensionsLoading: "dimensions...",

  noImagesToReview: "No images to review.",
  pleaseCheckImages: (i) => `Please check images: ${i}`,
  imageOf: (i, t) => `Image ${i} of ${t}`,
  generateData: "Generate data",
  edit: "Edit",
  backToEditTitle: "Return to editing?",
  backToEditMessage:
    "This will discard the current results and return to the edit page.",
  resetTitle: "Reset everything?",
  resetMessage:
    "This will remove all images and results and return to the start.",
  reset: "Reset",
  delete: "Delete",
  files: "Files",
  loadingImage: "Loading image...",
  processingPoints: "Processing points...",
  errorMsg: (m) => `Error: ${m}`,
  points: "Points",
  previous: "Previous",
  next: "Next",
  imageMetadata: "Image metadata",
  csv: "CSV",
  selectAtLeastOne: "Select at least one option.",
  cancel: "Cancel",
  download: "Download",
  dimensionsPx: (w, h) => `${w}×${h}px`,

  detectionModel: "Detection model",
  statusReady: "Ready",
  statusLoading: "Loading",
  checking: "Checking...",
  loadModel: "Load model",
  loadingModel: "Loading model...",
  modelReady: "Model loaded and ready",
  reloadModel: "Reload model",
  tryAgain: "Try again",

  imagePreviewOf: (i, t) => `Image ${i} of ${t}`,
  unknownType: "unknown type",
  boundingBoxOn: "Bounding box on",
  boundingBoxOff: "Bounding box off",
  boundingBoxesOn: "Bounding boxes on",
  boundingBoxesOff: "Bounding boxes off",
  confidenceOn: "Confidence on",
  confidenceOff: "Confidence off",
  extractWings: "Extract wings",
  skipProcessing: "Skip",
  processImage: "Process",
  flipHorizontal: "↔ Flip H",
  flipVertical: "↕ Flip V",
  rotateCw: "↻ 90°",
  rotateCcw: "↺ 90°",

  help: "Help",
  howToUse: "How to use WingAI",
  workflowLabel: "Workflow",
  keyboardShortcutsLabel: "Keyboard shortcuts",
  steps: [
    {
      step: "Upload images",
      detail: "Drag & drop or click to select images. Supported formats: JPEG, PNG, WebP.",
    },
    {
      step: "Load the detection model",
      detail: 'Open "Detection model" in the header and click "Load model". The model is cached in the browser — you only need to do this once.',
    },
    {
      step: "Detect objects",
      detail: 'Click "Detect" to run detection on all images. Images already detected or marked as Skip are skipped automatically. You can also detect a single image from its preview.',
    },
    {
      step: "Review bounding boxes",
      detail: "Open a preview to see all detected bounding boxes. Use the checkbox on each box to include/exclude it from extracting. The green box is the one used for cropping. You can also flip the image or extract each detected wing as a separate image.",
    },
    {
      step: "Process",
      detail: "Use the Process/Skip toggle per image to control which images are sent to processing. Skipped images are excluded entirely.",
    },
    {
      step: "Review results",
      detail: "After processing, inspect the results. You can edit landmark positions directly on the image and zoom in and out for precise adjustments.",
    },
    {
      step: "Download data",
      detail: "Export your results in CSV format for spreadsheet analysis, or in Identifly format for direct use in the Identifly workflow.",
    },
  ],
  shortcuts: [
    {
      context: "Image preview",
      rows: [
        { keys: ["←", "→"], description: "Previous / next image" },
        { keys: ["B"], description: "Toggle bounding box on / off" },
        { keys: ["Tab"], description: "Select next bounding box" },
        { keys: ["Shift", "Tab"], description: "Select previous bounding box" },
        { keys: ["H"], description: "Flip image horizontally (clears detections)" },
        { keys: ["V"], description: "Flip image vertically (clears detections)" },
        { keys: ["N"], description: "Focus filename to rename" },
        { keys: ["Enter"], description: "Confirm rename" },
        { keys: ["Delete"], description: "Delete current image" },
        { keys: ["Esc"], description: "Close preview" },
      ],
    },
    {
      context: "Review view",
      rows: [
        { keys: ["←", "→"], description: "Previous / next result" },
        { keys: ["N"], description: "Focus filename to rename" },
        { keys: ["Enter"], description: "Confirm rename" },
      ],
    },
  ],
};

const pl: Translations = {
  darkMode: "Tryb ciemny",
  downloadInProgress: "Pobieranie w toku...",
  detectingObjects: "Wykrywanie skrzydeł...",
  detectingObjectsProgress: (c, t) => `Wykrywanie skrzydeł... ${c}/${t}`,
  processingImages: (c, t) => `Przetwarzanie zdjęć... ${c}/${t}`,

  close: "Zamknij",
  homeLabel: "Strona główna WingAI",
  selectLanguage: "Wybierz język",
  imagePreviewLabel: "Podgląd obrazu",

  dropFilesHere: "Upuść pliki tutaj...",
  dragPhotosHere: "Przeciągnij zdjęcia tutaj lub kliknij, aby wybrać",
  supportedFormats: "Obsługiwane formaty: .png, .jpg",

  uploadedImages: (n) => {
    if (n === 1) return "Wgrano 1 zdjęcie:";
    if (n >= 2 && n <= 4) return `Wgrano ${n} zdjęcia:`;
    return `Wgrano ${n} zdjęć:`;
  },
  typeToFilter: "Filtruj...",
  process: "Przetwórz",
  preview: "Podgląd",
  clear: "Wyczyść",
  detect: "Wykryj",
  detectionFailed: (e) => `Wykrywanie nie powiodło się: ${e}`,
  noFilesMatch: "Brak plików pasujących do filtra.",
  dimensionsLoading: "wymiary...",

  noImagesToReview: "Brak zdjęć do przeglądu.",
  pleaseCheckImages: (i) => `Sprawdź zdjęcia: ${i}`,
  imageOf: (i, t) => `Zdjęcie ${i} z ${t}`,
  generateData: "Generuj dane",
  edit: "Edytuj",
  backToEditTitle: "Wrócić do edycji?",
  backToEditMessage:
    "Spowoduje to odrzucenie bieżących wyników i powrót do strony edycji.",
  resetTitle: "Zresetować wszystko?",
  resetMessage:
    "Spowoduje to usunięcie wszystkich zdjęć i wyników oraz powrót do początku.",
  reset: "Resetuj",
  delete: "Usuń",
  files: "Pliki",
  loadingImage: "Ładowanie zdjęcia...",
  processingPoints: "Przetwarzanie punktów...",
  errorMsg: (m) => `Błąd: ${m}`,
  points: "Punkty",
  previous: "Poprzedni",
  next: "Następny",
  imageMetadata: "Metadane zdjęcia",
  csv: "CSV",
  selectAtLeastOne: "Wybierz co najmniej jedną opcję.",
  cancel: "Anuluj",
  download: "Pobierz",
  dimensionsPx: (w, h) => `${w}×${h}px`,

  detectionModel: "Model wykrywania",
  statusReady: "Gotowy",
  statusLoading: "Ładowanie",
  checking: "Sprawdzanie...",
  loadModel: "Załaduj model",
  loadingModel: "Ładowanie modelu...",
  modelReady: "Model załadowany i gotowy",
  reloadModel: "Przeładuj model",
  tryAgain: "Spróbuj ponownie",

  imagePreviewOf: (i, t) => `Zdjęcie ${i} z ${t}`,
  unknownType: "nieznany format",
  boundingBoxOn: "Ramka włączona",
  boundingBoxOff: "Ramka wyłączona",
  boundingBoxesOn: "Ramki włączone",
  boundingBoxesOff: "Ramki wyłączone",
  confidenceOn: "Pewność włączona",
  confidenceOff: "Pewność wyłączona",
  extractWings: "Wyodrębnij skrzydła",
  skipProcessing: "Pomiń",
  processImage: "Przetwarzaj",
  flipHorizontal: "↔ Odwróć poziomo",
  flipVertical: "↕ Odwróć pionowo",
  rotateCw: "↻ 90°",
  rotateCcw: "↺ 90°",

  help: "Pomoc",
  howToUse: "Jak używać WingAI",
  workflowLabel: "Przepływ pracy",
  keyboardShortcutsLabel: "Skróty klawiszowe",
  steps: [
    {
      step: "Prześlij zdjęcia",
      detail: "Przeciągnij i upuść lub kliknij, aby wybrać zdjęcia. Obsługiwane formaty: JPEG, PNG.",
    },
    {
      step: "Załaduj model wykrywania",
      detail: 'Otwórz „Model wykrywania" w nagłówku i kliknij „Załaduj model". Model jest zapisywany w przeglądarce — wystarczy zrobić to raz.',
    },
    {
      step: "Wykryj obiekty",
      detail: 'Kliknij „Wykryj", aby uruchomić wykrywanie na skrzydeł wszystkich zdjęciach. Zdjęcia już wykryte lub oznaczone jako Pomiń są automatycznie pomijane. Możesz też uruchomić wykrywanie na pojedynczym zdjęciu z jego podglądu.',
    },
    {
      step: "Przejrzyj ramki",
      detail: "Otwórz podgląd, aby zobaczyć wszystkie wykryte ramki. Użyj pola wyboru przy każdej ramce, aby uwzględnić lub wykluczyć ją z wyodrębniania. Zielona ramka jest używana do przycinania. Możesz też odwrócić zdjęcie lub wyodrębnić każde skrzydło jako osobny plik.",
    },
    {
      step: "Przetwórz",
      detail: "Użyj przełącznika Przetwórz/Pomiń przy każdym zdjęciu, aby kontrolować, które zdjęcia trafią do przetwarzania. Pominięte zdjęcia są całkowicie wykluczone.",
    },
    {
      step: "Przejrzyj wyniki",
      detail: "Po przetworzeniu sprawdź wyniki. Możesz edytować pozycje punktów charakterystycznych bezpośrednio na zdjęciu i powiększać obraz dla dokładnych korekt.",
    },
    {
      step: "Pobierz dane",
      detail: "Eksportuj wyniki w formacie CSV do analizy w arkuszu kalkulacyjnym lub w formacie Identifly do bezpośredniego użycia w przepływie pracy Identifly.",
    },
  ],
  shortcuts: [
    {
      context: "Podgląd zdjęcia",
      rows: [
        { keys: ["←", "→"], description: "Poprzednie / następne zdjęcie" },
        { keys: ["B"], description: "Włącz / wyłącz ramkę" },
        { keys: ["Tab"], description: "Wybierz następną ramkę" },
        { keys: ["Shift", "Tab"], description: "Wybierz poprzednią ramkę" },
        { keys: ["H"], description: "Odwróć zdjęcie poziomo (usuwa wykrycia)" },
        { keys: ["V"], description: "Odwróć zdjęcie pionowo (usuwa wykrycia)" },
        { keys: ["N"], description: "Aktywuj pole nazwy pliku" },
        { keys: ["Enter"], description: "Zatwierdź zmianę nazwy" },
        { keys: ["Delete"], description: "Usuń bieżące zdjęcie" },
        { keys: ["Esc"], description: "Zamknij podgląd" },
      ],
    },
    {
      context: "Widok przeglądu",
      rows: [
        { keys: ["←", "→"], description: "Poprzedni / następny wynik" },
        { keys: ["N"], description: "Aktywuj pole nazwy pliku" },
        { keys: ["Enter"], description: "Zatwierdź zmianę nazwy" },
      ],
    },
  ],
};

const TRANSLATIONS: Record<Lang, Translations> = { EN: en, PL: pl };

type LanguageContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translations;
};

const LanguageContext = createContext<LanguageContextValue>({
  lang: "EN",
  setLang: () => {},
  t: en,
});

const LANG_STORAGE_KEY = "wingai-lang";

function isLang(value: unknown): value is Lang {
  return value === "EN" || value === "PL";
}

function getInitialLang(): Lang {
  if (typeof window === "undefined") return "EN";
  const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
  return isLang(stored) ? stored : "EN";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(getInitialLang);

  useEffect(() => {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t: TRANSLATIONS[lang] }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useT() {
  return useContext(LanguageContext).t;
}

export function useLang() {
  const { lang, setLang } = useContext(LanguageContext);
  return [lang, setLang] as const;
}
