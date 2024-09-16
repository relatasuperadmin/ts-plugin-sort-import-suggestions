import type ts from "typescript";

function init(modules: { typescript: typeof import("typescript/lib/tsserverlibrary") }) {
  const ts = modules.typescript;

  function create(info: ts.server.PluginCreateInfo) {
    const moveUpPatterns: string[] = info.config.moveUpPatterns ?? ["@/", "\\.{1,2}/"]; // matches `../` or `./`
    const moveDownPatterns: string[] = info.config.moveDownPatterns ?? [];
    const moveUpRegexes: RegExp[] = moveUpPatterns.map((pattern) => new RegExp(pattern));
    const moveDownRegexes: RegExp[] = moveDownPatterns.map((pattern) => new RegExp(pattern));

    // Diagnostic logging
    info.project.projectService.logger.info("TSSortImportSuggestionsPlugin: Started");

    // Set up decorator object
    const proxy: ts.LanguageService = Object.create(null);
    for (let k of Object.keys(info.languageService) as Array<keyof ts.LanguageService>) {
      const x = info.languageService[k]!;
      // @ts-expect-error - JS runtime trickery which is tricky to type tersely
      proxy[k] = (...args: Array<{}>) => x.apply(info.languageService, args);
    }

    // Helper function to find the longest common substring (LCS)
    function longestCommonSubstring(str1: string, str2: string): number {
      const m = str1.length;
      const n = str2.length;
      let maxLength = 0;

      const table: number[][] = Array(m + 1).fill([]).map(() => Array(n + 1).fill(0));

      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          if (str1[i - 1] === str2[j - 1]) {
            table[i][j] = table[i - 1][j - 1] + 1;
            maxLength = Math.max(maxLength, table[i][j]);
          }
        }
      }

      return maxLength;
    }

    // Extract file prefix if the path contains "-feature"
    function getFeaturePrefix(filePath: string): string | null {
      const featureIndex = filePath.indexOf("-feature");
      if (featureIndex !== -1) {
        return filePath.substring(0, featureIndex);
      }
      return null;
    }

    // Override completions
    proxy.getCompletionsAtPosition = (fileName, position, options, ...restArgs) => {
      const prior = info.languageService.getCompletionsAtPosition(fileName, position, options, ...restArgs);
      if (!prior) return;

      const featurePrefix = getFeaturePrefix(fileName);

      prior.entries = prior.entries.map((e) => {
        const newEntry = { ...e };
        const source = e.source;

        if (source) {
          if (featurePrefix && source.startsWith(featurePrefix)) {
            // Move this item up if its source starts with the feature prefix
            newEntry.sortText =
              e.sortText.slice(0, -1) +
              String.fromCharCode(e.sortText.slice(-1).charCodeAt(0) - 1) +
              "0";
          } else if (moveUpRegexes.some((re) => re.test(source))) {
            // Move this item to the bottom of its previous group
            newEntry.sortText =
              e.sortText.slice(0, -1) +
              String.fromCharCode(e.sortText.slice(-1).charCodeAt(0) - 1) +
              "1";
          } else if (moveDownRegexes.some((re) => re.test(source))) {
            // Move this item to the bottom of its group
            newEntry.sortText = newEntry.sortText + "1";
          }
        }

        return newEntry;
      });

      // Sort by longest common substring match
      if (featurePrefix) {
        prior.entries.sort((a, b) => {
          const aSource = a.source || "";
          const bSource = b.source || "";
          const aLCS = longestCommonSubstring(featurePrefix, aSource);
          const bLCS = longestCommonSubstring(featurePrefix, bSource);
          return bLCS - aLCS; // Sort in descending order of LCS
        });
      }

      return prior;
    };

    proxy.getCodeFixesAtPosition = (
      fileName: string,
      start: number,
      end: number,
      errorCodes: readonly number[],
      formatOptions: ts.FormatCodeSettings,
      preferences: ts.UserPreferences,
    ) => {
      const prior = info.languageService.getCodeFixesAtPosition(
        fileName,
        start,
        end,
        errorCodes,
        formatOptions,
        preferences,
      );

      const featurePrefix = getFeaturePrefix(fileName);

      const newFixes = [...prior]
        .sort((a, b) => {
          const aLCS = featurePrefix ? longestCommonSubstring(featurePrefix, a.description) : 0;
          const bLCS = featurePrefix ? longestCommonSubstring(featurePrefix, b.description) : 0;

          return bLCS - aLCS; // Sort by LCS in descending order
        })

      return newFixes;
    };

    return proxy;
  }

  return { create };
}

export = init;
