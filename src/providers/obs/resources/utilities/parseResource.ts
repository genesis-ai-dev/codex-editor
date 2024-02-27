import {
    getResponseData,
    resourceFromResourceLink,
} from "./resourceFromResourceLink";
import tsvToJson from "./tsvToJson";

export const parseResource = async ({
    config,
    reference,
    resourceLink,
    options = {},
}: {
    config: any;
    reference: any;
    resourceLink: any;
    options?: any;
}) => {
    const resource = await resourceFromResourceLink({
        resourceLink,
        reference,
        config,
    });

    const res = await resource?.project?.file();
    const isTSV = resource?.project?.path?.includes(".tsv");
    let content = getResponseData(res);

    if (isTSV) {
        content = tsvToJson(content);
    }
    return {
        resource,
        content,
        contentFileResponse: res,
    };
};
