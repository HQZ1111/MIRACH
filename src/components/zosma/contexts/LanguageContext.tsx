import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from "react";

type Lang = "en" | "zh";

const translations: Record<Lang, Record<string, string>> = {
  en: {
    "splash.title": "DeepSeek Harness",
    "splash.subtitle": "Connect your AI accounts and start working — your credentials stay on your machine.",
    "splash.benefit1": "Works with Claude, ChatGPT, Copilot, and local models",
    "splash.benefit2": "Your API keys and data never leave this device",
    "splash.cta": "Connect your AI",
    "connect.title": "Connect your AI",
    "connect.subtitle": "Pick one option below.",
    "connect.zosma.recommended": "recommended",
    "connect.zosma.desc": "Sign in with Google. Cowork sets up your available Zosma models automatically.",
    "connect.zosma.continue": "Continue with Google",
    "connect.zosma.starting": "Starting…",
    "connect.zosma.settingUp": "Setting up your models…",
    "connect.zosma.complete": "Connected! Setting up your experience…",
    "connect.zosma.browser": "Complete sign-in in your browser",
    "connect.zosma.cancel": "Cancel",
    "connect.zosma.retry": "Retry",
    "connect.api.title": "API Key",
    "connect.api.fastest": "fastest",
    "connect.api.desc": "Pick the provider this key belongs to, paste the key, and you're in.",
    "connect.api.provider": "Provider",
    "connect.api.loading": "Loading providers…",
    "connect.api.placeholder": "sk-…",
    "connect.api.connect": "Connect",
    "connect.api.checking": "Checking key…",
    "connect.api.saving": "Saving…",
    "connect.api.formatWarn": "Key format doesn't match typical pattern — proceed with caution.",
    "connect.api.couldntVerify": "Couldn't auto-verify this provider — proceed with caution.",
    "connect.api.offline": "Couldn't verify key (offline or network issue) — saving anyway.",
    "connect.api.savedLocally": "Saved locally.",
    "connect.api.providerRequired": "Pick a provider for this key.",
    "connect.api.engineNotRunning": "The AI engine is not running. Try restarting or download the latest release.",
    "connect.api.engineStarting": "Waiting for the AI engine to start. Please try again in a moment.",
    "connect.api.saveFailed": "Failed to save API key",
    "connect.custom": "Custom Local LLM",
    "connect.divider": "or use a subscription",
    "connect.claude": "Claude Pro/Max",
    "connect.claudeDesc": "Use your Claude subscription",
    "connect.github": "GitHub Copilot",
    "connect.githubDesc": "Use your GitHub subscription",
    "connect.chatgpt": "ChatGPT",
    "connect.chatgptDesc": "Use your ChatGPT Plus / Pro subscription",
    "back": "Back",
    "skip": "Skip",
    "continue": "Continue",
    "language": "Language",
    "language.zh": "中文",
    "language.en": "English",
  },
  zh: {
    "splash.title": "DeepSeek Harness",
    "splash.subtitle": "连接你的 AI 账号并开始工作 — 你的凭证保存在本地设备上。",
    "splash.benefit1": "支持 Claude、ChatGPT、Copilot 和本地模型",
    "splash.benefit2": "你的 API 密钥和数据不会离开此设备",
    "splash.cta": "连接你的 AI",
    "connect.title": "连接你的 AI",
    "connect.subtitle": "选择以下选项之一。",
    "connect.zosma.recommended": "推荐",
    "connect.zosma.desc": "使用 Google 登录。Cowork 会自动设置你可用的 Zosma 模型。",
    "connect.zosma.continue": "使用 Google 继续",
    "connect.zosma.starting": "启动中…",
    "connect.zosma.settingUp": "正在设置你的模型…",
    "connect.zosma.complete": "已连接！正在设置你的体验…",
    "connect.zosma.browser": "在浏览器中完成登录",
    "connect.zosma.cancel": "取消",
    "connect.zosma.retry": "重试",
    "connect.api.title": "API 密钥",
    "connect.api.fastest": "最快",
    "connect.api.desc": "选择此密钥所属的提供商，粘贴密钥即可使用。",
    "connect.api.provider": "提供商",
    "connect.api.loading": "加载提供商中…",
    "connect.api.placeholder": "sk-…",
    "connect.api.connect": "连接",
    "connect.api.checking": "检查密钥中…",
    "connect.api.saving": "保存中…",
    "connect.api.formatWarn": "密钥格式不匹配典型模式 — 请谨慎继续。",
    "connect.api.couldntVerify": "无法自动验证此提供商 — 请谨慎继续。",
    "connect.api.offline": "无法验证密钥（离线或网络问题）— 仍然保存。",
    "connect.api.savedLocally": "已保存到本地。",
    "connect.api.providerRequired": "请为此密钥选择提供商。",
    "connect.api.engineNotRunning": "AI 引擎未运行。请重试或下载最新版本。",
    "connect.api.engineStarting": "等待 AI 引擎启动。请稍后再试。",
    "connect.api.saveFailed": "保存 API 密钥失败",
    "connect.custom": "自定义本地 LLM",
    "connect.divider": "或使用订阅",
    "connect.claude": "Claude Pro/Max",
    "connect.claudeDesc": "使用你的 Claude 订阅",
    "connect.github": "GitHub Copilot",
    "connect.githubDesc": "使用你的 GitHub 订阅",
    "connect.chatgpt": "ChatGPT",
    "connect.chatgptDesc": "使用你的 ChatGPT Plus / Pro 订阅",
    "back": "返回",
    "skip": "跳过",
    "continue": "继续",
    "language": "语言",
    "language.zh": "中文",
    "language.en": "English",
    // 主界面
    "main.newChat": "新建对话",
    "main.search": "搜索对话...",
    "main.settings": "设置",
    "main.allFolders": "所有文件夹",
    "main.noSessions": "暂无对话",
    "main.deleteChat": "删除对话？",
    "main.deleteChatDesc": "此对话将被永久删除，无法撤销。",
    "main.delete": "删除",
    "main.cancel": "取消",
    "main.rename": "重命名",
    "main.pin": "置顶",
    "main.unpin": "取消置顶",
    "chat.placeholder": "输入消息...",
    "chat.send": "发送",
    "chat.stop": "停止",
    "chat.retry": "重试",
    "chat.model": "模型",
    "chat.selectModel": "选择模型",
    "chat.thinking": "思考中...",
    "chat.streaming": "回复中...",
    "chat.notReady": "未就绪...",
    "chat.steer": "Enter 发送指令",
    "settings.title": "设置",
    "settings.general": "通用",
    "settings.appearance": "外观",
    "settings.language": "语言",
    "settings.models": "模型",
    "settings.providers": "提供商",
    "settings.apiKeys": "API 密钥",
    "settings.customProvider": "自定义提供商",
    "settings.addProvider": "添加提供商",
    "settings.name": "名称",
    "settings.baseUrl": "基础 URL",
    "settings.apiKey": "API 密钥",
    "settings.save": "保存",
    "settings.saved": "已保存",
    "settings.cancel": "取消",
    "settings.delete": "删除",
    "settings.confirm": "确认",
    "settings.enabled": "已启用",
    "settings.disabled": "已禁用",
    "settings.darkMode": "深色模式",
    "settings.lightMode": "浅色模式",
    "settings.systemMode": "跟随系统",
  },
};

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return (localStorage.getItem("zosma_lang") as Lang) || "zh";
    } catch {
      return "zh";
    }
  });

  useEffect(() => {
    localStorage.setItem("zosma_lang", lang);
  }, [lang]);

  const t = useCallback(
    (key: string): string => {
      return translations[lang]?.[key] || translations.en[key] || key;
    },
    [lang],
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLang must be used within LanguageProvider");
  return ctx;
}
