import {motion} from 'framer-motion';
import {useTranslations} from 'next-intl';

export default function Analysis() {
    const t = useTranslations('Onboarding.analysis');

    return (
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-8">
            <div className="text-center space-y-4">
                <p className="text-foreground/80 text-xl">
                    {t('description')}
                </p>
            </div>

            <motion.div
                className="w-16 h-16 border-4 border-muted-foreground rounded-full border-t-transparent"
                animate={{rotate: 360}}
                transition={{duration: 1, repeat: Infinity, ease: "linear"}}
            />
        </div>
    );
} 