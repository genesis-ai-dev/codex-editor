/**
 * Patch for @fetsorn/isogit-lfs library to work correctly with GitLab LFS responses
 * 
 * The library has a bug in its response validation that fails with GitLab's LFS responses.
 * This patch fixes the validation logic.
 */

import lfs from '@fetsorn/isogit-lfs';

// Store original uploadBlobs function
let originalUploadBlobs: any = null;
let isPatched = false;

/**
 * Fixed validation function that properly handles GitLab LFS responses
 */
function isValidLFSInfoResponseData(val: any): boolean {
    try {
        // Check if response has the expected structure
        if (!val || !Array.isArray(val.objects)) {
            console.warn("[LFS Patch] Invalid response structure:", val);
            return false;
        }

        const obj = val.objects[0];
        if (!obj) {
            console.warn("[LFS Patch] No objects in response");
            return false;
        }

        // If there are no actions, it means the server already has the file
        if (!obj.actions) {
            console.log("[LFS Patch] Server already has file (no actions needed)");
            return true;
        }

        // Check if upload action has required properties
        const uploadAction = obj.actions.upload;
        if (!uploadAction) {
            console.warn("[LFS Patch] No upload action in response");
            return false;
        }

        // Check if href exists and is a string (the original bug was here)
        if (!uploadAction.href || typeof uploadAction.href !== 'string') {
            console.warn("[LFS Patch] Invalid or missing href in upload action:", uploadAction.href);
            return false;
        }

        console.log("[LFS Patch] Response validation passed");
        return true;
    } catch (error) {
        console.error("[LFS Patch] Error validating response:", error);
        return false;
    }
}

/**
 * Patched uploadBlobs function with corrected validation
 */
async function patchedUploadBlobs(
    { headers = {}, url, auth }: { headers?: any, url: string, auth?: any; },
    contents: Uint8Array[]
): Promise<any[]> {
    console.log("[LFS Patch] Using patched uploadBlobs function");
    console.log("[LFS Patch] URL:", url);
    console.log("[LFS Patch] Auth object:", auth);

    // Use the original library's buildPointerInfo function
    const buildPointerInfo = (lfs as any).buildPointerInfo;
    const getAuthHeader = (lfs as any).getAuthHeader || (() => ({}));

    if (!buildPointerInfo) {
        throw new Error("Unable to access buildPointerInfo from LFS library");
    }

    const infos = await Promise.all(contents.map((c: Uint8Array) => buildPointerInfo(c)));

    // Build authentication headers - handle the auth object properly
    let authHeaders: Record<string, string> = {};
    if (auth) {
        if (auth.username && auth.password) {
            // Basic authentication
            const credentials = `${auth.username}:${auth.password}`;
            authHeaders.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
            console.log("[LFS Patch] Using Basic auth for user:", auth.username);
        } else if (auth.token) {
            // Token authentication
            authHeaders.Authorization = `Bearer ${auth.token}`;
            console.log("[LFS Patch] Using Bearer token auth");
        } else {
            // Try the library's getAuthHeader as fallback
            authHeaders = getAuthHeader(auth);
            console.log("[LFS Patch] Using library's auth method");
        }
    } else {
        console.log("[LFS Patch] No authentication provided");
    }

    // Request LFS transfer
    const lfsInfoRequestData = {
        operation: "upload",
        transfers: ["basic"],
        objects: infos,
    };

    console.log("[LFS Patch] Making request to:", `${url}/info/lfs/objects/batch`);
    console.log("[LFS Patch] Request data:", lfsInfoRequestData);
    console.log("[LFS Patch] Auth headers:", Object.keys(authHeaders));

    const lfsInfoRes = await fetch(`${url}/info/lfs/objects/batch`, {
        method: "POST",
        headers: {
            ...headers,
            ...authHeaders,
            Accept: "application/vnd.git-lfs+json",
            "Content-Type": "application/vnd.git-lfs+json",
        },
        body: JSON.stringify(lfsInfoRequestData),
    });

    if (!lfsInfoRes.ok) {
        const errorText = await lfsInfoRes.text();
        console.error("[LFS Patch] Request failed:");
        console.error("Status:", lfsInfoRes.status, lfsInfoRes.statusText);
        console.error("Response:", errorText);
        console.error("Request URL:", `${url}/info/lfs/objects/batch`);
        console.error("Request headers:", { ...headers, ...authHeaders });
        throw new Error(`LFS request failed with status ${lfsInfoRes.status}: ${lfsInfoRes.statusText}\nResponse: ${errorText}`);
    }

    const lfsInfoResponseData = await lfsInfoRes.json();
    console.log("[LFS Patch] Server response:", lfsInfoResponseData);

    // Use our fixed validation
    if (!isValidLFSInfoResponseData(lfsInfoResponseData)) {
        console.error("[LFS Patch] Invalid response data:", lfsInfoResponseData);
        throw new Error("Unexpected JSON structure received for LFS upload request");
    }

    // Upload each object
    await Promise.all(
        lfsInfoResponseData.objects.map(async (object: any, index: number) => {
            // Server already has file
            if (!object.actions) {
                console.log(`[LFS Patch] Server already has file ${index}`);
                return;
            }

            const { actions } = object;

            console.log(`[LFS Patch] Uploading file ${index} to:`, actions.upload.href);
            console.log(`[LFS Patch] Upload headers for file ${index}:`, {
                ...headers,
                ...authHeaders,
                ...(actions.upload.header ?? {}),
                // Don't override Content-Type if it's set by the server
                ...(actions.upload.header?.['Content-Type'] ? {} : { 'Content-Type': 'application/octet-stream' }),
            });
            console.log(`[LFS Patch] File size:`, contents[index].length, 'bytes');

            try {
                // Use the specific headers provided by GitLab for the upload
                // These include the proper authentication for the LFS storage
                const uploadHeaders = {
                    ...headers,
                    // Use GitLab's provided headers (which include auth)
                    ...(actions.upload.header ?? {}),
                    // Only add Content-Type if not already specified
                    ...(actions.upload.header?.['Content-Type'] ? {} : { 'Content-Type': 'application/octet-stream' }),
                };

                // Remove headers that Node.js fetch doesn't allow to be set manually
                delete uploadHeaders['Transfer-Encoding'];
                delete uploadHeaders['Content-Length'];

                console.log(`[LFS Patch] Final upload headers:`, uploadHeaders);

                // Create AbortController for timeout handling
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout

                const resp = await fetch(actions.upload.href, {
                    method: "PUT",
                    headers: uploadHeaders,
                    body: contents[index],
                    signal: controller.signal,
                    // Add keepalive for large uploads
                    keepalive: false
                });

                clearTimeout(timeoutId);

                if (!resp.ok) {
                    const errorText = await resp.text();
                    console.error(`[LFS Patch] Upload failed for file ${index}:`);
                    console.error("Status:", resp.status, resp.statusText);
                    console.error("Response:", errorText);
                    throw new Error(
                        `Upload failed for file ${index}, HTTP ${resp.status}: ${resp.statusText}\nResponse: ${errorText}`
                    );
                }

                console.log(`[LFS Patch] File ${index} uploaded successfully`);
            } catch (fetchError: any) {
                console.error(`[LFS Patch] Network error uploading file ${index}:`, fetchError);
                console.error(`[LFS Patch] Error details:`, {
                    message: fetchError.message,
                    cause: fetchError.cause,
                    code: fetchError.code,
                    stack: fetchError.stack
                });

                // Log the cause in more detail if it exists
                if (fetchError.cause) {
                    console.error(`[LFS Patch] Error cause details:`, {
                        message: fetchError.cause.message,
                        code: fetchError.cause.code,
                        errno: fetchError.cause.errno,
                        syscall: fetchError.cause.syscall,
                        address: fetchError.cause.address,
                        port: fetchError.cause.port,
                        stack: fetchError.cause.stack
                    });
                }

                // Provide more helpful error messages based on the error type
                if (fetchError.message?.includes('certificate') || fetchError.message?.includes('SSL') || fetchError.message?.includes('TLS')) {
                    throw new Error(`SSL/Certificate error uploading to LFS storage. This may be a self-signed certificate issue. Original error: ${fetchError.message}`);
                } else if (fetchError.message?.includes('ECONNREFUSED') || fetchError.message?.includes('ENOTFOUND')) {
                    throw new Error(`Network connection error uploading to LFS storage. Check if the LFS storage server is accessible. Original error: ${fetchError.message}`);
                } else if (fetchError.message?.includes('timeout')) {
                    throw new Error(`Upload timeout to LFS storage. The file may be too large or the connection too slow. Original error: ${fetchError.message}`);
                } else {
                    throw new Error(`Network error uploading to LFS storage: ${fetchError.message}`);
                }
            }

            // Handle verification if required
            if (actions.verify) {
                console.log(`[LFS Patch] Verifying file ${index}`);
                const verificationResp = await fetch(actions.verify.href, {
                    method: "POST",
                    headers: {
                        ...(actions.verify.header ?? {}),
                        Accept: "application/vnd.git-lfs+json",
                        "Content-Type": "application/vnd.git-lfs+json",
                    },
                    body: JSON.stringify(infos[index]),
                });

                if (!verificationResp.ok) {
                    throw new Error(
                        `Verification failed for file ${index}, HTTP ${verificationResp.status}: ${verificationResp.statusText}`
                    );
                }
            }
        })
    );

    console.log("[LFS Patch] Upload completed successfully");
    return infos;
}

/**
 * Apply the patch to the LFS library
 */
export function patchLFSLibrary(): void {
    if (isPatched) {
        console.log("[LFS Patch] Library already patched");
        return;
    }

    console.log("[LFS Patch] Applying patch to isogit-lfs library");

    try {
        // Store original function
        originalUploadBlobs = lfs.uploadBlobs;

        // Replace with patched version
        (lfs as any).uploadBlobs = patchedUploadBlobs;

        isPatched = true;
        console.log("[LFS Patch] Patch applied successfully");
    } catch (error) {
        console.error("[LFS Patch] Failed to apply patch:", error);
        throw error;
    }
}

/**
 * Remove the patch (for testing purposes)
 */
export function unpatchLFSLibrary(): void {
    if (!isPatched || !originalUploadBlobs) {
        console.log("[LFS Patch] No patch to remove");
        return;
    }

    console.log("[LFS Patch] Removing patch from isogit-lfs library");

    try {
        // Restore original function
        (lfs as any).uploadBlobs = originalUploadBlobs;

        isPatched = false;
        originalUploadBlobs = null;
        console.log("[LFS Patch] Patch removed successfully");
    } catch (error) {
        console.error("[LFS Patch] Failed to remove patch:", error);
        throw error;
    }
}