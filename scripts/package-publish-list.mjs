export const publishablePackages = [
  '@proofhound/shared',
  '@proofhound/logger',
  '@proofhound/crypto',
  '@proofhound/limiter',
  '@proofhound/db',
  '@proofhound/orchestration-shared',
  '@proofhound/connector-client',
  '@proofhound/judgment',
  '@proofhound/metrics',
  '@proofhound/llm-client',
  '@proofhound/optimization-strategy',
  '@proofhound/api-client',
  '@proofhound/ui',
  '@proofhound/web-ui',
  '@proofhound/core',
];

export function packageShortName(packageName) {
  return packageName.replace('@proofhound/', '');
}
