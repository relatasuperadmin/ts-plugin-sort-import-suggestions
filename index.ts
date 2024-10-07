import type ts from "typescript";

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

// Function to extract filename from full path in the description
function extractFileName(description: string): string | null {
  const match = description.match(/["'](.+?)["']/); // Regex to extract path between quotes
  if (match && match[1]) {
    const fullPath = match[1];
    return fullPath.split('/').pop() || 'Unknown File'; // Get last part of the path as filename
  }
  return null;
}

function init(modules: { typescript: typeof import("typescript/lib/tsserverlibrary") }) {
  const ts = modules.typescript;

  function create(info: ts.server.PluginCreateInfo) {
    // Diagnostic logging
    info.project.projectService.logger.info("TSSortImportSuggestionsPlugin: Started");

    // Set up decorator object
    const proxy: ts.LanguageService = Object.create(null);
    for (let k of Object.keys(info.languageService) as Array<keyof ts.LanguageService>) {
      const x = info.languageService[k]!;
      // @ts-expect-error - JS runtime trickery which is tricky to type tersely
      proxy[k] = (...args: Array<{}>) => x.apply(info.languageService, args);
    }

    // Override completions
    proxy.getCompletionsAtPosition = (fileName, position, options, ...restArgs) => {
      const originalCompletionSuggestions = info.languageService.getCompletionsAtPosition(fileName, position, options, ...restArgs);
      if (!originalCompletionSuggestions) return;

      const featurePrefix = getFeaturePrefix(fileName);

      // Sort by longest common substring match
      if (featurePrefix) {
        originalCompletionSuggestions.entries.sort((a, b) => {
          const aSource = a.source || "";
          const bSource = b.source || "";
          const aLCS = longestCommonSubstring(featurePrefix, aSource);
          const bLCS = longestCommonSubstring(featurePrefix, bSource);
          return bLCS - aLCS; // Sort in descending order of LCS
        });
      }

      return originalCompletionSuggestions;
    };

    // Override code fixes
    proxy.getCodeFixesAtPosition = (
      fileName: string,
      start: number,
      end: number,
      errorCodes: readonly number[],
      formatOptions: ts.FormatCodeSettings,
      preferences: ts.UserPreferences,
    ) => {
      const originalCodeFixSuggestions = info.languageService.getCodeFixesAtPosition(
        fileName,
        start,
        end,
        errorCodes,
        formatOptions,
        preferences,
      );
      const featurePrefix = getFeaturePrefix(fileName);

      return [...originalCodeFixSuggestions]
        .sort((a, b) => {
          const aLCS = featurePrefix ? longestCommonSubstring(featurePrefix, a.description) : 0;
          const bLCS = featurePrefix ? longestCommonSubstring(featurePrefix, b.description) : 0;
          return bLCS - aLCS; // Sort by LCS in descending order
        })
        .map(suggestion => {
          const extractedFileName = extractFileName(suggestion.description); // Extract filename from description
          const description = extractedFileName ? `${extractedFileName} :: ${suggestion.description}` : suggestion.description;
          return {
            ...suggestion,
            description:  description// Updated description with filename
          };
        });

    };

    return proxy;
  }

  return { create };
}

export = init;