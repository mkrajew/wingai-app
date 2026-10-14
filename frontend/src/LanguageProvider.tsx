import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  LANG_STORAGE_KEY,
  LanguageContext,
  TRANSLATIONS,
  getInitialLang,
} from "./i18n";
import type { Lang } from "./i18n";

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
