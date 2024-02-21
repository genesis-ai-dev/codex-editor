import moment from "moment";
import burrito from "../../data/OBSTemplate.json";

const createObsSB = (
    username: any,
    projectFields: { projectName: string; abbreviation: string },
    language: any,
    langCode: string,
    direction: string | undefined,
    copyright: { licence: string | any[] },
    id: any,
): Record<string, any> => {
    let json: Record<string, any> = {};
    json = burrito;

    json.meta.generator.userName = username;
    json.meta.generator.softwareVersion = "0.0.1"; //TODO: fix the versioning
    json.meta.dateCreated = moment().format();
    json.identification.primary = {
        scribe: {
            [id]: {
                revision: "1",
                timestamp: moment().format(),
            },
        },
    };
    json.languages[0].tag = langCode;
    json.languages[0].scriptDirection = direction?.toLowerCase();
    json.identification.name.en = projectFields.projectName;
    json.identification.abbreviation.en = projectFields.abbreviation;
    json.languages[0].name.en = language;
    json.copyright.licenses[0].ingredient = "license.md";
    return json;
};
export default createObsSB;
