import * as vscode from 'vscode';

export interface ProgressStep {
    name: string;
    message: string;
    weight: number;
}

export class ProgressManager {
    private currentStep: number = 0;
    private totalWeight: number = 0;
    private steps: ProgressStep[] = [];

    constructor(
        private progress: vscode.Progress<{ message?: string; increment?: number }>,
        steps: ProgressStep[]
    ) {
        this.steps = steps;
        this.totalWeight = steps.reduce((sum, step) => sum + step.weight, 0);
    }

    async nextStep(token?: vscode.CancellationToken): Promise<void> {
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }

        const step = this.steps[this.currentStep];
        if (!step) return;

        const increment = (step.weight / this.totalWeight) * 100;
        this.progress.report({ message: step.message, increment });
        this.currentStep++;
    }

    getCurrentStep(): ProgressStep | undefined {
        return this.steps[this.currentStep];
    }
}
