import axios from "axios";
import {
    APIConfig,
    AuthorizationHeaders,
    AuthorizationHeadersObject,
    ExtendConfig,
    Get,
} from "./types";

//  TODO: Look into cache implementation in the future
export const get = async ({
    url,
    params,
    config,
    noCache,
    fullResponse,
}: Get): Promise<any> => {
    const _config = config ? extendConfig(config) : {};
    let response: any;

    try {
        // also check config for noCache
        const _params = { noCache: Math.random(), ...params };
        response = await axios.get(url, { ..._config, params: _params });
    } catch (e: any) {
        // will arrive here if server is online
        if (fullResponse) {
            if (e?.response) {
                // if http error, get response
                response = e?.response;
            } else {
                // this is not http error, so get what we can from exception
                response = {
                    statusText: e?.toString(),
                    status: 1,
                };
            }
        }
    }

    if (fullResponse) {
        return response;
    }
    const data = response ? response.data : null;
    return data;
};

export const extendConfig = (config: ExtendConfig): APIConfig => {
    let headers = { ...config.headers };

    if (config && config.token) {
        // TODO: CHECK AUTH HEADERS
        // const authHeaders = authorizationHeaders({ token: config.token });
        headers = { ...config.headers };
    }

    const _config = {
        baseURL: config.server,
        ...config,
        headers,
    };
    return _config;
};

// export const authorizationHeaders: AuthorizationHeaders = ({
//     username,
//     password,
//     token,
// }) => {
//     let headers: AuthorizationHeadersObject = {
//         "Content-Type": "",
//         Authorization: "",
//     };
//     // const authorization = encodeAuthentication({
//     //     username,
//     //     password,
//     //     token,
//     // });

//     // if (authorization) {
//     //     headers = {
//     //         "Content-Type": "application/json",
//     //         Authorization: authorization,
//     //     };
//     // }
//     return headers;
// };
