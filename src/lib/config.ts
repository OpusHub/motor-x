import { getJSON, putJSON } from "./store";
import { AppConfig, DEFAULT_CONFIG } from "./types";

const PATH = "config.json";

export async function loadConfig(): Promise<AppConfig> {
  const saved = await getJSON<Partial<AppConfig>>(PATH);
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    windows: { ...DEFAULT_CONFIG.windows, ...saved?.windows },
    channels: {
      x: { ...DEFAULT_CONFIG.channels.x, ...saved?.channels?.x },
      linkedin: { ...DEFAULT_CONFIG.channels.linkedin, ...saved?.channels?.linkedin },
    },
  };
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await putJSON(PATH, config);
}
