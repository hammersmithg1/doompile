import { test as base, type Page } from "@playwright/test";
export { expect, type Page } from "@playwright/test";
export const browserTestUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "browser@example.test",
  name: "Browser test",
  provider: "google",
  admin: false,
};
/** UI editor tests mock their API; authentication is an explicit fixture too. */
export const test = base.extend({
  page: async ({ page, context }, use) => {
    await context.route("**/api/session", (route) =>
      route.fulfill({
        json: {
          authenticated: true,
          user: browserTestUser,
          providers: [
            { id: "yandex", enabled: false },
            { id: "google", enabled: false },
          ],
          development: false,
        },
      }),
    );
    await context.route("**/api/notes", (route) =>
      route.fulfill({ json: { notes: [] } }),
    );
    await context.route("**/api/link-preview?**", (route) => {
      const url = new URL(route.request().url()).searchParams.get("url")!;
      return route.fulfill({
        json: { url, title: "", description: "", siteName: new URL(url).hostname, type: "website" },
      });
    });
    await use(page);
  },
});

export function microphoneWAV(seconds = 0.05) {
  const sampleRate = 8000;
  const samples = Math.round(seconds * sampleRate);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const amplitude = 9000 * Math.sin(4 * Math.PI * i / samples) ** 2;
    bytes.writeInt16LE(Math.round(amplitude * Math.sin(i * 2 * Math.PI * 160 / sampleRate)), 44 + i * 2);
  }
  return bytes;
}

export async function mockMicrophone(page: Page, withSignal = false) {
  await page.addInitScript(({ withSignal, bytes }) => {
    const metrics = { starts: 0, stops: 0, tracksStopped: 0 };
    (window as any).microphoneMetrics = metrics;
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: withSignal ? class {
        resume = async () => {};
        close = async () => {};
        decodeAudioData = (data: ArrayBuffer) =>
          new OfflineAudioContext(1, 1, 8000).decodeAudioData(data);
        createMediaStreamSource = () => ({ connect() {} });
        createAnalyser() {
          let phase = 0;
          return {
            fftSize: 512,
            getFloatTimeDomainData(data: Float32Array) {
              phase += 0.23;
              data.fill(Math.sin(phase) * 0.15);
            },
          };
        }
      } : undefined,
    });
    const chunk = new Blob([new Uint8Array(bytes)], { type: "audio/wav" });
    class Recorder {
      state = "inactive";
      mimeType = "audio/wav";
      timer: any;
      ondataavailable: any;
      onstop: any;
      onerror: any;
      emitted = false;
      start(slice: number) {
        this.state = "recording";
        metrics.starts++;
        this.timer = setInterval(() => this.requestData(), slice);
      }
      requestData() {
        if (withSignal && this.emitted) return;
        this.emitted = true;
        this.ondataavailable?.({ data: chunk });
      }
      stop() {
        if (this.state !== "recording") return;
        this.state = "inactive";
        clearInterval(this.timer);
        metrics.stops++;
        this.requestData();
        setTimeout(() => this.onstop?.(), 0);
      }
    }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [
            {
              stop() {
                metrics.tracksStopped++;
              },
            },
          ],
        }),
      },
    });
    (window as any).MediaRecorder = Recorder;
  }, { withSignal, bytes: Array.from(microphoneWAV(withSignal ? 2 : 0.05)) });
}
