import { Logger } from '@babylonjs/core/Misc/logger.js';

let reportedIssues = 0;

export function reportStabilityIssue(scope: string, message: string, detail?: unknown): void {
  reportedIssues += 1;
  if (detail === undefined) console.error(`[${scope}] ${message}`);
  else console.error(`[${scope}] ${message}`, detail);
}

/** Installs bounded, removable runtime diagnostics for one active game instance. */
export class StabilityDiagnostics {
  private readonly babylonErrorBaseline = Logger.errorsCount;
  private readonly reportedIssueBaseline = reportedIssues;
  private uncaughtErrors = 0;
  private unhandledRejections = 0;

  private readonly onError = () => {
    this.uncaughtErrors += 1;
  };

  private readonly onUnhandledRejection = () => {
    this.unhandledRejections += 1;
  };

  constructor() {
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onUnhandledRejection);
  }

  get errorCount(): number {
    return (
      Math.max(0, reportedIssues - this.reportedIssueBaseline) +
      this.uncaughtErrors +
      this.unhandledRejections +
      Math.max(0, Logger.errorsCount - this.babylonErrorBaseline)
    );
  }

  get summary(): string {
    return `errors ${this.errorCount} · uncaught ${this.uncaughtErrors} · promises ${this.unhandledRejections}`;
  }

  dispose(): void {
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
  }
}
