export function sanitizeCompanySettingsForClient(settings) {
    if (!settings) {
        return settings;
    }

    const plainSettings = settings.toObject ? settings.toObject() : { ...settings };

    if (plainSettings.integrations?.linkedin) {
        delete plainSettings.integrations.linkedin.accessToken;
        delete plainSettings.integrations.linkedin.refreshToken;
    }

    return plainSettings;
}