import burrito from "../../data/OBSTemplate.json";

export const updateVersion = (metadata: Record<string, any>) => {
    const sb = metadata;
    sb.format = "scripture burrito";
    sb.meta.version = burrito.meta.version;

    if (sb.copyright.fullStatementPlain) {
        sb.copyright.licenses = [{ ingredient: "" }];
        delete sb.copyright.fullStatementPlain;
        delete sb.copyright.publicDomain;
    }
    if (!sb.meta.defaultLocale) {
        sb.meta.defaultLocale = sb.meta.defaultLanguage;
        delete sb.meta.defaultLanguage;
    }

    // delete sb.type.flavorType.canonSpec;
    // delete sb.type.flavorType.canonType;
    return sb;
};
