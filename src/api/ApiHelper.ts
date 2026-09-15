import { APIRequestContext, APIResponse } from '@playwright/test';

export interface ApiResult<T = unknown> {
    status: number;
    body: T;
}

/**
 * Generic REST helper. Every method resolves — it never throws just because
 * a response wasn't valid JSON — so callers can assert on `status` and
 * `body` uniformly for both success and error paths.
 *
 * Verified live against ParaBank: error responses are correctly served as
 * `text/plain`, but several success responses (e.g. POST /deposit,
 * /withdraw, /transfer) are mislabeled `Content-Type: application/json`
 * while actually returning a raw, unquoted plain-text string. A naive
 * `response.json()` throws a SyntaxError on those. `parseBody` below
 * papers over both cases by trying JSON first and falling back to text.
 */
async function parseBody(response: APIResponse): Promise<unknown> {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

export class ApiHelper {
    private readonly request: APIRequestContext;
    private readonly baseURL: string;

    constructor(request: APIRequestContext, baseURL: string) {
        this.request = request;
        this.baseURL = baseURL;
    }

    async get(endPoint: string, headers?: Record<string, string>): Promise<ApiResult> {
        const response = await this.request.get(`${this.baseURL}${endPoint}`, { headers });
        return { status: response.status(), body: await parseBody(response) };
    }

    async post(endPoint: string, reqBody: object, headers?: Record<string, string>): Promise<ApiResult> {
        const response = await this.request.post(`${this.baseURL}${endPoint}`, { headers, data: reqBody });
        return { status: response.status(), body: await parseBody(response) };
    }

    async put(endPoint: string, reqBody: object, headers?: Record<string, string>): Promise<ApiResult> {
        const response = await this.request.put(`${this.baseURL}${endPoint}`, { headers, data: reqBody });
        return { status: response.status(), body: await parseBody(response) };
    }

    async patch(endPoint: string, reqBody: object, headers?: Record<string, string>): Promise<ApiResult> {
        const response = await this.request.patch(`${this.baseURL}${endPoint}`, { headers, data: reqBody });
        return { status: response.status(), body: await parseBody(response) };
    }

    async delete(endPoint: string, headers?: Record<string, string>): Promise<ApiResult> {
        const response = await this.request.delete(`${this.baseURL}${endPoint}`, { headers });
        return { status: response.status(), body: await parseBody(response) };
    }
}
