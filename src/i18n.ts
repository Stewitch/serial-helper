import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import commonZh from "./assets/locales/zh-CN/common.json";
import monitorZh from "./assets/locales/zh-CN/monitor.json";
import flashZh from "./assets/locales/zh-CN/flash.json";
import settingsZh from "./assets/locales/zh-CN/settings.json";

import commonEn from "./assets/locales/en-US/common.json";
import monitorEn from "./assets/locales/en-US/monitor.json";
import flashEn from "./assets/locales/en-US/flash.json";
import settingsEn from "./assets/locales/en-US/settings.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      "zh-CN": {
        common: commonZh,
        monitor: monitorZh,
        flash: flashZh,
        settings: settingsZh,
      },
      "en-US": {
        common: commonEn,
        monitor: monitorEn,
        flash: flashEn,
        settings: settingsEn,
      },
    },
    fallbackLng: "zh-CN",
    defaultNS: "common",
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

export default i18n;
