import {useTranslations} from 'next-intl';

export default function Introduction() {
    const t = useTranslations('Onboarding.introduction');

    return (
        <div className="text-center space-y-8 mt-12">
            <div>
                <div className="mb-4">
                    <h1 className="text-5xl font-bold mb-1">{t('title')}</h1>
                    <p className="text-xl text-muted-foreground">{t('subtitle')}</p>
                </div>
                <p className="text-xl text-foreground/80">{t('description')}</p>
            </div>

            <div className="text-sm text-muted-foreground bg-muted p-4 rounded-lg space-y-2">
                <p>{t('privacyNotice')}</p>
                <p>
                    {t('runLocally')}{' '}
                    <a
                        href="https://github.com/OpenHealthForAll/open-health"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary/80"
                    >
                        {t('here')}
                    </a>
                    .
                </p>
            </div>
        </div>
    );
} 