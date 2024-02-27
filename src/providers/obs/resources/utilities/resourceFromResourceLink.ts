import path from "path";
import { get } from "./giteaApi";
import { Axios, AxiosResponse } from "axios";
import YAML from "yaml";

export const resourceFromResourceLink = async ({
    resourceLink,
    reference,
    config,
}: {
    resourceLink: string;
    reference: any;
    config: any;
}) => {
    let manifestHttpResponse = null;

    // try {
    const resource = parseResourceLink({
        resourceLink,
        config,
        reference,
    });

    console.log("resource from resourceFromResourceLink: ", resource);
    const { manifest, response } = await getResourceManifest({
        ...resource,
        fullResponse: true,
    });
    manifestHttpResponse = response;
    const projects = manifest?.projects?.map((project: any) =>
        extendProject({
            project,
            resource,
            reference,
        }),
    );
    const projectId = reference ? reference.projectId || reference.bookId : "";
    const project = await projectFromProjects({
        reference,
        projectId,
        projects,
    });
    const _resource = {
        ...resource,
        reference,
        manifest,
        projects,
        project,
        manifestHttpResponse,
    };
    return _resource;
    // } catch (e) {
    //     const errorMessage =
    //         "scripture-resources-rcl: resources.js: Cannot load resource [" +
    //         resourceLink +
    //         "]";
    //     console.error(errorMessage, e);
    //     return { manifestHttpResponse };
    // }
};

// TODO: Add correct types
export const parseResourceLink = ({
    resourceLink,
    config,
    reference,
}: {
    resourceLink: string;
    config: any;
    reference: any;
}) => {
    let parsedArray,
        username,
        repository,
        languageId,
        resourceId,
        projectId = reference.projectId || reference.bookId,
        tag,
        ref,
        matched;
    ref = ref || tag || "master"; // fallback to using tag if ref not given
    const versionHttpMatch =
        /https?:\/\/.*org\/api\/v1\/repos\/([^/]*)\/([^/]*)\/([^/]*)([/][^/]*)*\?ref=([^/]+)/;
    const versionLinkMatch =
        /\/api\/v1\/repos\/([^/]*)\/([^/]*)\/([^/]*)([/][^/]*)*\?ref=([^/]+)/;

    if ((matched = resourceLink.match(versionHttpMatch))) {
        //https://git.door43.org/api/v1/repos/ru_gl/ru_rlob/contents?ref=v0.9
        //https://git.door43.org/api/v1/repos/ru_gl/ru_rlob/contents/manifest.yaml?ref=v0.9
        [, username, repository, , , ref] = matched;
        [languageId, resourceId] = repository.split("_");
    } else if ((matched = resourceLink.match(versionLinkMatch))) {
        // /api/v1/repos/ru_gl/ru_rlob/contents?ref=v0.9
        // /api/v1/repos/ru_gl/ru_rlob/contents/manifest.yaml?ref=v0.9
        [, username, repository, , , ref] = matched;
        [languageId, resourceId] = repository.split("_");
    } else if (
        (matched = resourceLink.match(/https?:\/\/.*org\/([^/]*)\/([^/]*).git/))
    ) {
        // https://git.door43.org/Door43-Catalog/en_ust.git
        [, username, repository] = matched;
        [languageId, resourceId] = repository.split("_");
    } else if (resourceLink.includes("/u/")) {
        // https://door43.org/u/unfoldingWord/en_ult/
        parsedArray = resourceLink.match(
            /https?:\/\/.*org\/u\/([^/]*)\/([^/]*)/,
        );
        [, username, repository] = parsedArray;
        [languageId, resourceId] = repository.split("_");
    } else if (
        resourceLink.includes("src/branch") ||
        resourceLink.includes("src/tag") ||
        resourceLink.includes("raw/branch") ||
        resourceLink.includes("raw/tag")
    ) {
        //https://git.door43.org/ru_gl/ru_rlob/src/branch/master
        //https://git.door43.org/ru_gl/ru_rlob/src/tag/v1.1.1
        //https://git.door43.org/ru_gl/ru_rlob/raw/tag/v1.1.1
        //https://git.door43.org/ru_gl/ru_rlob/src/branch/master/3jn
        parsedArray = resourceLink.match(
            /https?:\/\/.*org\/([^/]*)\/([^/]*)\/([^/]*)\/([^/]*)\/([^/]*)/,
        );
        [, username, repository, , , ref] = parsedArray;
        [languageId, resourceId] = repository.split("_");
    } else if (resourceLink.includes("http")) {
        //https://git.door43.org/ru_gl/ru_rlob
        //https://git.door43.org/ru_gl/ru_rlob/3jn
        parsedArray = resourceLink.match(/https?:\/\/.*org\/([^/]*)\/([^/]*)/);
        [, username, repository] = parsedArray;
        [languageId, resourceId] = repository.split("_");
    } else if (resourceLink.match(/^\/?([^/]*)\/([^/]*)\/?\/?([^/]*)?\/?$/)) {
        // /ru_gl/ru_rlob
        // /ru_gl/ru_rlob/3jn
        parsedArray = resourceLink.match(
            /^\/?([^/]*)\/([^/]*)\/?\/?([^/]*)?\/?$/,
        );
        [
            ,
            username,
            repository,
            projectId = reference.projectId || reference.bookId,
        ] = parsedArray;
        [languageId, resourceId] = repository.split("_");
    } else {
        //ru_gl/ru/rlob/master/
        //ru_gl/ru/rlob/master/tit
        parsedArray = resourceLink.split("/");
        [username, languageId, resourceId, ref = "master", projectId] =
            parsedArray;
        repository = `${languageId}_${resourceId}`;
    }

    if (!projectId || projectId == "" || projectId.length == 0) {
        projectId = reference.projectId || reference.bookId;
    }
    resourceLink = `${username}/${languageId}/${resourceId}/${ref}/${projectId}`;

    console.log("PARSE HERE: ", {
        resourceLink,
        username,
        repository,
        languageId,
        resourceId,
        tag: ref,
        ref,
        projectId,
        config,
    });

    return {
        resourceLink,
        username,
        repository,
        languageId,
        resourceId,
        tag: ref,
        ref,
        projectId,
        config,
    };
};

export const getResourceManifest = async ({
    username,
    languageId,
    resourceId,
    tag,
    ref,
    config,
    fullResponse,
}: {
    username: string;
    languageId: string;
    resourceId: string;
    tag: string;
    ref: string;
    config: Record<string, any>;
    fullResponse: boolean;
}) => {
    ref = ref || tag; // fallback to using   if ref not given
    const repository = `${languageId}_${resourceId}`;
    const path = "manifest.yaml";
    const response = await getFile({
        username,
        repository,
        path,
        ref,
        config,
        fullResponse,
    });
    const yaml = getResponseData(response);
    const manifest = yaml ? YAML.parseDocument(yaml) : null;

    return { manifest: manifest?.toJS(), response };
};

export const getFile = async ({
    username,
    repository,
    path: urlPath = "",
    tag,
    ref,
    config,
    fullResponse,
}: {
    username: string;
    repository: string;
    path: string;
    tag?: string;
    ref?: string;
    config: any;
    fullResponse: boolean;
}) => {
    let url;

    if (ref) {
        url =
            path.join(
                "api/v1/repos",
                username,
                repository,
                "contents",
                urlPath,
            ) + `?ref=${ref}`;
    } else if (tag && tag !== "master") {
        url = path.join(username, repository, "raw/tag", tag, urlPath);
    } else {
        // default to master
        url = path.join(username, repository, "raw/branch/master", urlPath);
    }

    try {
        const _config = { ...config }; // prevents gitea-react-toolkit from modifying object
        const response = await get({
            url,
            config: _config,
            fullResponse,
        });
        return response;
    } catch (error) {
        console.error(error);
        return null;
    }
};

/**
 * get data from http response and decode data in base64 format
 * @param {object} response - http response
 * @return {*} - response data decoded
 */
export function getResponseData(response: AxiosResponse<any>) {
    let data = response?.data;

    if (!data?.errors) {
        // make sure was not a fetch error
        data =
            data?.encoding === "base64"
                ? decodeBase64ToUtf8(data.content)
                : data;
        return data;
    }
    return null;
}

const decodeBase64ToUtf8 = (base64: string) => {
    return Buffer.from(base64, "base64").toString("utf8");
};

export const extendProject = ({
    project,
    resource,
    reference,
}: {
    project: any;
    resource: any;
    reference: any;
}) => {
    const _project = { ...project };
    const { projectId, resourceLink } = resource;

    // eslint-disable-next-line require-await
    _project.file = async () =>
        getResourceProjectFile({
            ...resource,
            project,
            filePath: reference?.filePath,
        });

    // Original code has a parser for USFM Files, but we'll load them differently
    // the code is here: https://github.com/unfoldingWord/scripture-resources-rcl/blob/f6c27635898297017fcb674ef929bf19a4ee32d7/src/core/resources.js#L242
    return _project;
};

export const getResourceProjectFile = async ({
    username,
    languageId,
    resourceId,
    ref,
    tag,
    project: { path: projectPath },
    config,
    filePath,
}: {
    username: string;
    languageId: string;
    resourceId: string;
    ref: string;
    tag: string;
    project: any;
    config: any;
    filePath: string;
}) => {
    const repository = `${languageId}_${resourceId}`;
    projectPath =
        filePath && filePath.length
            ? path.join(projectPath, filePath)
            : projectPath;

    const file = await getFile({
        username,
        repository,
        path: projectPath,
        ref,
        tag,
        config,
        fullResponse: true,
    });
    return file;
};

export const projectFromProjects = ({
    reference,
    projectId,
    projects,
}: {
    reference: any;
    projectId: string;
    projects: any[];
}) => {
    const identifier = reference
        ? reference?.projectId || reference?.bookId
        : projectId;
    const project = projects?.filter(
        (project) => project.identifier === identifier,
    )[0];
    return project;
};
