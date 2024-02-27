export interface AuthToken {
    sha1: string;
    id: string;
    name: string;
}

export interface TokenConfigWithHeaders {
    headers: object;
    server?: string;
    token: AuthToken;
    tokenid: string;
}

export interface APIConfig {
    server?: string;
    baseURL?: string;
    data?: object;
    tokenid?: string;
    headers?: object;
    token?: string;
    noCache?: boolean;
    skipNetworkCheck?: boolean;
}

export interface ExtendConfig {
    token?: string;
    tokenid?: string;
    headers?: object;
    server?: string;
    data?: object;
    dontCreateBranch?: boolean;
}

export interface Get {
    config: APIConfig | ExtendConfig;
    url: string;
    params?: object;
    noCache?: number | boolean;
    fullResponse?: boolean;
}

export interface AuthorizationHeaders {
    (args: {
        username: string;
        password: string;
        token?: string | AuthToken;
    }): AuthorizationHeadersObject;
    (args: {
        username?: string;
        password?: string;
        token: string | AuthToken;
    }): AuthorizationHeadersObject;
}

export interface AuthorizationHeadersObject {
    "Content-Type": string;
    Authorization: string;
}
