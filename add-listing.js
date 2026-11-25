import { createListing, validateListingDraft } from "./firestore.js";
import { validateListingImage } from "./cloudinary.js";

const form = document.getElementById("listing-form");
const submitButton = form?.querySelector(".submit-button");
const feedback = document.getElementById("listing-feedback");
const photoInput = document.getElementById("photo-input");
const transactionChoices = [...document.querySelectorAll(".choice")];
const fieldErrors = {
    title: { field: document.getElementById("item-name"), message: document.getElementById("item-name-error") },
    category: { field: document.getElementById("category"), message: document.getElementById("category-error") },
    condition: { field: document.getElementById("condition"), message: document.getElementById("condition-error") },
    description: { field: document.getElementById("description"), message: document.getElementById("description-error") },
    transactionType: { field: transactionChoices[0], message: document.getElementById("transaction-type-error") }
};

if (form && submitButton && feedback) {
    let saving = false;

    function clearErrors() {
        Object.values(fieldErrors).forEach(({ field, message }) => {
            message.textContent = "";
            field?.removeAttribute("aria-invalid");
        });
    }

    function showValidationErrors(errors) {
        let firstInvalidField = null;
        Object.entries(errors).forEach(([key, messageText]) => {
            const target = fieldErrors[key];
            if (!target) return;
            target.message.textContent = messageText;
            target.field?.setAttribute("aria-invalid", "true");
            if (!firstInvalidField) firstInvalidField = target.field;
        });
        firstInvalidField?.focus();
    }

    function getDraft() {
        return {
            title: document.getElementById("item-name").value,
            category: document.getElementById("category").value,
            condition: document.getElementById("condition").value,
            description: document.getElementById("description").value,
            transactionType: transactionChoices.find((choice) => choice.classList.contains("selected"))?.dataset.value || ""
        };
    }

    function readableSaveError(error) {
        if (error.code === "listing/email-verification-sent") {
            return "Firebase needs you to verify the email linked to your Google account. Check that inbox, verify the address, then return and submit this listing again. No listing was saved yet.";
        }
        if (error.code === "listing/email-verification-pending") {
            return "Email verification was already requested. Check your inbox and verify the address before trying again; no listing was saved yet.";
        }
        if (error.code === "listing/email-already-in-use") {
            return "That Google email is already assigned to another Firebase account. No listing was saved; the Firebase accounts must be reconciled before using this one.";
        }
        if (error.code === "listing/email-verification-failed") {
            return "Firebase could not send an email verification link. No listing was saved; try again later or ask the project administrator to check the Auth email settings.";
        }
        if (error.code === "listing/google-profile-unverified") {
            if (error.profileIssues?.includes("google-provider-profile-missing")) {
                return "This Firebase account has no linked Google profile. Sign out and use Continue with Google.";
            }
            if (error.profileIssues?.includes("firebase-name-claim-missing")) {
                return "Firebase Auth did not provide a Google display name. Add a name to your Google profile, then sign out and sign in again.";
            }
            if (error.profileIssues?.includes("firebase-email-claim-missing")) {
                return "Google has an email, but Firebase did not issue an email claim. A Google verification popup will open to refresh the Firebase account.";
            }
            if (error.profileIssues?.includes("firebase-email-claim-missing-after-reauth")) {
                return "Google reauthentication completed, but Firebase still issued no email claim. No listing was saved; the Firebase Auth account must provide an email claim to satisfy the listing security rule.";
            }
            if (error.profileIssues?.includes("firebase-user-email-missing")) {
                return "The signed-in Firebase account has no email address. Sign in with a Google account that provides an email before creating a listing.";
            }
            if (error.profileIssues?.includes("google-provider-email-missing")) {
                return "The linked Google profile has no email address, so the listing cannot satisfy Firebase's owner email rule.";
            }
            return "We couldn't verify your Google profile details. Sign out and sign in with Google again, then retry.";
        }
        if (error.code === "listing/google-email-mismatch") {
            return "The linked Google email and Firebase token email do not match. No listing was saved because the security rule requires them to match.";
        }
        if (error.code === "listing/firebase-email-mismatch") {
            return "The Firebase account email and its token email do not match. No listing was saved because the security rule requires the authenticated email.";
        }
        if (error.code === "listing/reauth-user-mismatch") {
            return "Google reauthentication returned a different Firebase account. No listing was saved.";
        }
        if (error.code === "permission-denied") {
            return "Firestore rejected this listing. Check that the latest firestore.rules are published, then try again.";
        }
        if (error.code === "listing/invalid-image" || error.code === "cloudinary/invalid-image") {
            return "Choose a JPG, JPEG, PNG, or WebP image no larger than 5 MB.";
        }
        if (error.code === "cloudinary/upload-failed") {
            return `Cloudinary could not upload the photo: ${error.message || "check the unsigned preset settings"} No listing was saved.`;
        }
        if (error.code === "cloudinary/timeout") {
            return "The photo upload took too long. Check your connection and retry; no listing was saved.";
        }
        if (error.code === "cloudinary/network-error") {
            return "Could not connect to Cloudinary. Check your connection and try again; no listing was saved.";
        }
        if (error.code?.startsWith("cloudinary/")) {
            return `${error.message || "The photo could not be uploaded."} No listing was saved.`;
        }
        if (error.code === "unavailable" || error.code === "auth/network-request-failed") {
            return "Could not reach Firestore. Check your internet connection and try again.";
        }
        return "Your listing could not be created. Please try again.";
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (saving) return;

        feedback.textContent = "";
        feedback.classList.remove("is-error", "is-success");
        clearErrors();

        const validation = validateListingDraft(getDraft());
        if (!validation.valid) {
            showValidationErrors(validation.errors);
            return;
        }

        const imageFile = photoInput?.files?.[0] || null;
        const imageValidationError = validateListingImage(imageFile);
        if (imageValidationError) {
            feedback.textContent = imageValidationError;
            feedback.classList.add("is-error");
            photoInput?.focus();
            return;
        }

        saving = true;
        submitButton.disabled = true;
        submitButton.textContent = "Checking account…";
        feedback.textContent = "Checking your account…";

        try {
            if (typeof window.rewearRequireAuth !== "function") {
                throw new Error("Authentication is not available. Refresh the page and try again.");
            }
            const user = await window.rewearRequireAuth("add-listing.html");
            if (!user) return;

            await createListing(validation.value, user, imageFile, (phase, percent) => {
                if (phase === "checking-profile") {
                    feedback.textContent = "Checking your Google profile…";
                    submitButton.textContent = "Checking account…";
                } else if (phase === "refreshing-profile") {
                    feedback.textContent = "Refreshing account details…";
                    submitButton.textContent = "Checking account…";
                } else if (phase === "checking-email") {
                    feedback.textContent = "Checking email verification…";
                } else if (phase === "requesting-verification") {
                    feedback.textContent = "Requesting email verification…";
                } else if (phase === "uploading") {
                    feedback.textContent = `Uploading photo… ${percent}%`;
                    submitButton.textContent = `Uploading… ${percent}%`;
                } else if (phase === "saving") {
                    feedback.textContent = "Saving your listing…";
                    submitButton.textContent = "Saving listing…";
                }
            });
            form.reset();
            transactionChoices.forEach((choice) => {
                const selected = choice.dataset.value === "Free";
                choice.classList.toggle("selected", selected);
                choice.setAttribute("aria-pressed", String(selected));
            });
            feedback.textContent = "Your listing has been created.";
            feedback.classList.add("is-success");
        } catch (error) {
            if (error.code === "listing/invalid-data" && error.validationErrors) {
                showValidationErrors(error.validationErrors);
            } else {
                console.error("ReWear listing creation failed:", { code: error.code || "unknown" });
                feedback.textContent = readableSaveError(error);
                feedback.classList.add("is-error");
            }
        } finally {
            saving = false;
            submitButton.disabled = false;
            submitButton.textContent = "Create listing";
        }
    });
}
