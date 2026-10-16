export const normalizeTimeToHms = (value: string) => {
  const parts = value.trim().split(":");
  const [rawH = "0", rawM = "0", rawS = "0"] = parts;
  const h = String(Number(rawH)).padStart(2, "0");
  const m = String(Number(rawM)).padStart(2, "0");
  const s = String(Number(rawS)).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

export const timeStringToSeconds = (value: string) => {
  const normalized = normalizeTimeToHms(value);
  const [h, m, s] = normalized.split(":").map(Number);
  return h * 3600 + m * 60 + s;
};

export const secondsToHms = (value: number) => {
  const total = Math.max(0, Math.floor(value));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

export const addSecondsToHm = (hm: string, seconds: number) => {
  const total = (timeStringToSeconds(hm) + seconds) % 86400;
  return secondsToHms(total).slice(0, 5);
};
