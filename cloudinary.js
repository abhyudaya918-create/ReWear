const CLOUDINARY_CLOUD_NAME = "claplqvp";
const CLOUDINARY_UPLOAD_PRESET = "rewear_listings";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
const MAX_LISTING_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

export function validateListingImage(file) {
    if (!file) return "";
    if (!(file instanceof Blob)) return "Choose an image file.";
    if (file.size <= 0 || file.size > MAX_LISTING_IMAGE_SIZE) {
        return "Choose an image that is no larger than 5 MB.";
    }

    const extension = file.name?.split(".").pop()?.toLowerCase() || "";
    const validType = ALLOWED_IMAGE_TYPES.has(file.type) || (!file.type && ALLOWED_IMAGE_EXTENSIONS.has(extension));
    const validExtension = !extension || ALLOWED_IMAGE_EXTENSIONS.has(extension);
    if (!validType || !validExtension) {
        return "Choose a JPG, JPEG, PNG, or WebP image.";
    }
    return "";
}

export function uploadListingImage(file, onProgress = () => {}) {
    const validationMessage = validateListingImage(file);
    if (validationMessage) {
        const error = new Error(validationMessage);
        error.code = "cloudinary/invalid-image";
        return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
        const body = new FormData();
        body.append("file", file);
        body.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

        const request = new XMLHttpRequest();
        request.open("POST", CLOUDINARY_UPLOAD_URL);
        request.timeout = 120000;

        request.upload.addEventListener("progress", (event) => {
            if (!event.lengthComputable || event.total <= 0) return;
            onProgress(Math.round((event.loaded / event.total) * 100));
        });
        request.addEventListener("load", () => {
            let result;
            try {
                result = JSON.parse(request.responseText);
            } catch (error) {
                reject(makeCloudinaryError("Cloudinary returned an unreadable response.", "cloudinary/invalid-response"));
                return;
            }

            if (request.status < 200 || request.status >= 300) {
                reject(makeCloudinaryError(
                    result?.error?.message || "Cloudinary rejected the photo upload.",
                    "cloudinary/upload-failed"
                ));
                return;
            }

            if (typeof result?.secure_url !== "string" || !result.secure_url.startsWith("https://")) {
                reject(makeCloudinaryError("Cloudinary did not return a secure image URL.", "cloudinary/missing-secure-url"));
                return;
            }
            resolve(result.secure_url);
        });
        request.addEventListener("error", () => {
            reject(makeCloudinaryError("Could not connect to Cloudinary. Check your connection and try again.", "cloudinary/network-error"));
        });
        request.addEventListener("timeout", () => {
            reject(makeCloudinaryError("The photo upload took too long. Check your connection and try again.", "cloudinary/timeout"));
        });
        request.addEventListener("abort", () => {
            reject(makeCloudinaryError("The photo upload was cancelled.", "cloudinary/cancelled"));
        });
        request.send(body);
    });
}

function makeCloudinaryError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}
