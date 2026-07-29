interface ProgressBarProps {
    currentStep: number;
    totalSteps: number;
}

export default function ProgressBar({currentStep, totalSteps}: ProgressBarProps) {
    const progress = (currentStep / totalSteps) * 100;

    return (
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
                className="h-full bg-primary transition-all duration-300 ease-in-out"
                style={{width: `${progress}%`}}
            />
        </div>
    );
} 