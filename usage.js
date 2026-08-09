const QRUsage = {
  async get() {
    return browser.storage.local.get(["usageLog", "usageTotals"]);
  },

  costOf(usage) {
    return (
      usage.prompt_tokens * CONFIG.COST_PER_M_INPUT +
      usage.completion_tokens * CONFIG.COST_PER_M_OUTPUT
    ) / 1000000;
  },

  async record(entry) {
    const data = await this.get();
    const usageLog = data.usageLog || [];
    const usageTotals = data.usageTotals || { calls: 0, cached: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
    usageLog.push(entry);
    usageTotals.calls += 1;
    usageTotals.promptTokens += entry.promptTokens;
    usageTotals.completionTokens += entry.completionTokens;
    usageTotals.costUsd += entry.costUsd;
    await browser.storage.local.set({
      usageLog: usageLog.slice(-CONFIG.USAGE_LOG_CAP),
      usageTotals
    });
  },

  async recordHit() {
    const data = await this.get();
    const usageTotals = data.usageTotals || { calls: 0, cached: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
    usageTotals.cached = (usageTotals.cached || 0) + 1;
    await browser.storage.local.set({ usageTotals });
  },

  async attachMetrics(host, mode, metrics) {
    const { usageLog = [] } = await this.get();
    for (let i = usageLog.length - 1; i >= 0; i--) {
      const e = usageLog[i];
      if (e.host === host && e.mode === mode && !e.metrics) {
        e.metrics = metrics;
        await browser.storage.local.set({ usageLog });
        return;
      }
    }
  },

  async clear() {
    await browser.storage.local.set({
      usageLog: [],
      usageTotals: { calls: 0, cached: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 }
    });
  }
};
