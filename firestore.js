// Shared Firestore helpers and client-side listing validation for ReWear.
import {
    GoogleAuthProvider,
    reauthenticateWithPopup,
    updateProfile,
    verifyBeforeUpdateEmail
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    getFirestore,
    limit,
    query,
    serverTimestamp,
    setDoc,
    startAfter,
    where
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";
import { auth, firebaseApp } from "./firebase-config.js";
import { uploadListingImage, validateListingImage } from "./cloudinary.js";

/**
 * @typedef {Object} ListingDocument
 * @property {string} id Firestore document ID (added by the read helpers).
 * @property {string} title Item name.
 * @property {string} category One of LISTING_CATEGORIES.
 * @property {string} condition Good, Medium, or Poor.
 * @property {string} description Item description.
 * @property {"free"|"exchange"} transactionType Stored in lowercase.
 * @property {string} ownerUid Firebase Authentication UID.
 * @property {string} ownerName Owner's Google display name.
 * @property {string} ownerEmail Owner's Google email address.
 * @property {string=} ownerPhotoURL Optional owner profile image URL.
 * @property {Object} createdAt Firestore Timestamp created with serverTimestamp().
 * @property {"active"|"removed"} status Listing visibility state.
 * @property {string=} imageURL Optional Cloudinary secure image URL.
 */

export const db = getFirestore(firebaseApp);
export const LISTINGS_COLLECTION = "listings";
export const LISTING_CATEGORIES = Object.freeze([
    "Textbooks / Workbooks",
    "Stationery",
    "Uniforms / PE Kits",
    "Art & Craft Supplies",
    "Sports Equipment",
    "Electronics",
    "School Bags / Lunchboxes",
    "Other"
]);
export const LISTING_CONDITIONS = Object.freeze(["Good", "Medium", "Poor"]);
export const LISTING_TRANSACTION_TYPES = Object.freeze(["free", "exchange"]);
const EMAIL_VERIFICATION_PENDING_MS = 24 * 60 * 60 * 1000;

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 2000;

function cleanText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function getEmailPresenceDiagnostics(user, claims) {
    const googleProfile = user?.providerData?.find((profile) => profile.providerId === "google.com");
    const googleEmail = typeof googleProfile?.email === "string" ? googleProfile.email : "";
    const tokenEmail = typeof claims?.email === "string" ? claims.email : "";

    return {
        firebaseUserPresent: Boolean(user),
        uidPresent: Boolean(user?.uid),
        displayNamePresent: Boolean(user?.displayName),
        firebaseEmailPresent: Boolean(user?.email),
        providerDataPresent: Boolean(user?.providerData?.length),
        googleProviderPresent: Boolean(googleProfile),
        googleProviderEmailPresent: Boolean(googleEmail),
        tokenEmailClaimPresent: Boolean(tokenEmail),
        tokenEmailVerifiedClaimPresent: typeof claims?.email_verified === "boolean",
        tokenEmailVerified: claims?.email_verified === true,
        googleEmailMatchesToken: Boolean(googleEmail && tokenEmail && googleEmail === tokenEmail)
    };
}

/**
 * Validate and normalize the fields collected by Add Listing.
 * Transaction values are normalized to the stored values "free" or "exchange".
 */
export function validateListingDraft(draft) {
    const source = draft && typeof draft === "object" ? draft : {};
    const title = cleanText(source.title);
    const category = cleanText(source.category);
    const condition = cleanText(source.condition);
    const description = cleanText(source.description);
    const rawTransactionType = cleanText(source.transactionType).toLowerCase();
    const errors = {};

    if (!title) errors.title = "Enter an item name.";
    else if (title.length > MAX_TITLE_LENGTH) errors.title = `Use ${MAX_TITLE_LENGTH} characters or fewer.`;

    if (!LISTING_CATEGORIES.includes(category)) errors.category = "Choose a listed category.";
    if (!LISTING_CONDITIONS.includes(condition)) errors.condition = "Choose Good, Medium, or Poor.";

    if (!description) errors.description = "Enter a description.";
    else if (description.length > MAX_DESCRIPTION_LENGTH) {
        errors.description = `Use ${MAX_DESCRIPTION_LENGTH} characters or fewer.`;
    }

    if (!LISTING_TRANSACTION_TYPES.includes(rawTransactionType)) {
        errors.transactionType = "Choose Free or Exchange.";
    }

    const valid = Object.keys(errors).length === 0;
    return {
        valid,
        errors,
        value: valid ? {
            title,
            category,
            condition,
            description,
            transactionType: rawTransactionType
        } : null
    };
}

/**
 * Save one validated listing for the currently signed-in user.
 * Owner identity always comes from Firebase Authentication, never the form.
 */
export async function createListing(draft, authenticatedUser, imageFile = null, onStatus = () => {}) {
    onStatus("checking-profile");
    let user = auth.currentUser;
    const submitUserWasCurrentAuthObject = Boolean(user && authenticatedUser === user);
    if (!user || !authenticatedUser || authenticatedUser.uid !== user.uid) {
        console.info("[ReWear] Listing auth diagnostics", {
            firebaseProjectId: auth.app.options.projectId,
            currentUserAvailable: Boolean(user),
            currentUidAvailable: Boolean(user?.uid),
            submitUserAvailable: Boolean(authenticatedUser),
            sameUserObjectAsCurrentAuthUser: Boolean(user && authenticatedUser === user),
            submitUidMatchesCurrentUser: Boolean(user && authenticatedUser && authenticatedUser.uid === user.uid)
        });
        const error = new Error("Sign in before creating a listing.");
        error.code = "auth/unauthenticated";
        throw error;
    }

    const validation = validateListingDraft(draft);
    if (!validation.valid) {
        const error = new Error("The listing details need attention.");
        error.code = "listing/invalid-data";
        error.validationErrors = validation.errors;
        throw error;
    }

    onStatus("refreshing-profile");
    const beforeReloadClaims = (await user.getIdTokenResult()).claims;
    const beforeReloadDiagnostics = getEmailPresenceDiagnostics(user, beforeReloadClaims);

    // Refresh persisted Auth account data before reading providerData and token claims.
    await user.reload();
    user = auth.currentUser;
    if (!user || user.uid !== authenticatedUser.uid) {
        const error = new Error("The signed-in Firebase account changed while preparing the listing.");
        error.code = "auth/user-mismatch";
        throw error;
    }

    let googleProfile = user.providerData?.find((profile) => profile.providerId === "google.com");
    const googleDisplayName = typeof googleProfile?.displayName === "string" ? googleProfile.displayName.trim() : "";

    // If the signed token lacks a name claim, sync only that missing Firebase Auth
    // profile value from Google, then refresh claims for the existing rules check.
    let tokenClaims = (await user.getIdTokenResult(true)).claims;
    if (!(typeof tokenClaims.name === "string" && tokenClaims.name.trim()) && googleDisplayName) {
        await updateProfile(user, { displayName: googleDisplayName });
        tokenClaims = (await user.getIdTokenResult(true)).claims;
    }

    // A refreshed token cannot add an email claim when the current Firebase
    // session was issued without one. Reauthenticate with the already-linked
    // Google provider only in that specific case, then use Firebase's new claim.
    let googleReauthenticationAttempted = false;
    let reauthResultMatchesCurrentAuthUser = false;
    let linkedGoogleEmail = typeof googleProfile?.email === "string" ? googleProfile.email.trim() : "";
    if (!tokenClaims.email && linkedGoogleEmail) {
        googleReauthenticationAttempted = true;
        const googleProvider = new GoogleAuthProvider();
        googleProvider.addScope("email");
        googleProvider.setCustomParameters({ prompt: "select_account" });
        const reauthentication = await reauthenticateWithPopup(user, googleProvider);
        if (reauthentication.user.uid !== user.uid) {
            const error = new Error("The Google reauthentication resolved to a different Firebase account.");
            error.code = "listing/reauth-user-mismatch";
            throw error;
        }
        user = auth.currentUser;
        reauthResultMatchesCurrentAuthUser = Boolean(user && reauthentication.user === user);
        if (!user || user.uid !== authenticatedUser.uid) {
            const error = new Error("The Firebase account changed during Google reauthentication.");
            error.code = "listing/reauth-user-mismatch";
            throw error;
        }
        await user.reload();
        user = auth.currentUser;
        if (!user || user.uid !== authenticatedUser.uid) {
            const error = new Error("The Firebase account changed while refreshing after Google reauthentication.");
            error.code = "listing/reauth-user-mismatch";
            throw error;
        }
        googleProfile = user.providerData?.find((profile) => profile.providerId === "google.com");
        linkedGoogleEmail = typeof googleProfile?.email === "string" ? googleProfile.email.trim() : "";
        tokenClaims = (await user.getIdTokenResult(true)).claims;
    }

    if (typeof user.email === "string" && user.email.trim()) {
        try {
            window.localStorage.removeItem(`rewear-email-verification-pending:${user.uid}`);
        } catch (error) {
            // Storage may be unavailable; verification still proceeds from Auth state.
        }
    }

    if (!(typeof user.email === "string" && user.email.trim()) && linkedGoogleEmail) {
        const verificationKey = `rewear-email-verification-pending:${user.uid}`;
        let verificationPending = false;
        try {
            const sentAt = Number(window.localStorage.getItem(verificationKey));
            verificationPending = Number.isFinite(sentAt) && Date.now() - sentAt < EMAIL_VERIFICATION_PENDING_MS;
            if (!verificationPending) window.localStorage.removeItem(verificationKey);
        } catch (error) {
            // Continue with Auth as the source of truth if browser storage is unavailable.
        }
        if (verificationPending) {
            const error = new Error("Email verification has already been requested for this account.");
            error.code = "listing/email-verification-pending";
            throw error;
        }

        try {
            // Do not trust an unverified providerData email as the Auth email.
            // Firebase updates the account only after the recipient verifies it.
            onStatus("requesting-verification");
            await verifyBeforeUpdateEmail(user, linkedGoogleEmail);
            try {
                window.localStorage.setItem(verificationKey, String(Date.now()));
            } catch (error) {
                // The user can still complete email verification without this reminder.
            }
        } catch (cause) {
            const error = new Error("Firebase could not start email verification for the linked Google address.");
            error.code = cause?.code === "auth/email-already-in-use"
                ? "listing/email-already-in-use"
                : "listing/email-verification-failed";
            throw error;
        }

        const error = new Error("Firebase email verification is required before creating a listing.");
        error.code = "listing/email-verification-sent";
        throw error;
    }

    const ownerName = typeof tokenClaims.name === "string" ? tokenClaims.name : "";
    const ownerEmail = typeof user.email === "string" ? user.email : "";
    const tokenEmail = typeof tokenClaims.email === "string" ? tokenClaims.email : "";
    const ownerPhotoURL = typeof tokenClaims.picture === "string" ? tokenClaims.picture : "";
    const googleEmail = typeof googleProfile?.email === "string" ? googleProfile.email : "";
    const afterReloadDiagnostics = getEmailPresenceDiagnostics(user, tokenClaims);

    // All values written to the diagnostic are booleans; no PII or token material is logged.
    console.info("[ReWear] Listing Auth email diagnostics", {
        firebaseProjectId: auth.app.options.projectId,
        sharedFirebaseApp: auth.app === firebaseApp,
        authStateReadyAtSubmit: true,
        submitUserWasCurrentAuthObject,
        sameUserObjectAsCurrentAuthUser: authenticatedUser === user,
        submitUserMatchesCurrentUser: authenticatedUser.uid === user.uid,
        googleReauthenticationAttempted,
        reauthResultMatchesCurrentAuthUser,
        beforeReload: beforeReloadDiagnostics,
        afterReload: afterReloadDiagnostics
    });

    const profileIssues = [];
    onStatus("checking-email");
    if (!googleProfile) profileIssues.push("google-provider-profile-missing");
    if (!ownerName) profileIssues.push("firebase-name-claim-missing");
    else if (ownerName.length > 100) profileIssues.push("firebase-name-claim-too-long");
    if (!ownerEmail) profileIssues.push("firebase-user-email-missing");
    if (!tokenEmail) {
        profileIssues.push(googleEmail
            ? (googleReauthenticationAttempted ? "firebase-email-claim-missing-after-reauth" : "firebase-email-claim-missing")
            : "google-provider-email-missing");
    }
    else if (tokenEmail.length > 254) profileIssues.push("firebase-email-claim-too-long");

    if (ownerEmail && tokenEmail && ownerEmail !== tokenEmail) {
        const error = new Error("The Firebase user email does not match the authenticated token email claim.");
        error.code = "listing/firebase-email-mismatch";
        throw error;
    }

    if (profileIssues.length > 0) {
        const error = new Error("The signed-in Google profile could not be verified for this listing.");
        error.code = "listing/google-profile-unverified";
        error.profileIssues = profileIssues;
        throw error;
    }

    const imageValidationError = validateListingImage(imageFile);
    if (imageValidationError) {
        const error = new Error(imageValidationError);
        error.code = "cloudinary/invalid-image";
        throw error;
    }

    let imageURL = "";
    if (imageFile) {
        onStatus("uploading", 0);
        imageURL = await uploadListingImage(imageFile, (percent) => {
            onStatus("uploading", percent);
        });
    }

    const listingData = {
        ...validation.value,
        ownerUid: user.uid,
        ownerName,
        ownerEmail,
        createdAt: serverTimestamp(),
        status: "active"
    };

    if (ownerPhotoURL.length > 0 && ownerPhotoURL.length <= 2048) {
        listingData.ownerPhotoURL = ownerPhotoURL;
    }
    if (imageURL) listingData.imageURL = imageURL;

    const listingRef = doc(collection(db, LISTINGS_COLLECTION));
    onStatus("saving");
    await setDoc(listingRef, listingData);
    return listingRef;
}

function timestampToMillis(value) {
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (typeof value?.toDate === "function") return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function newestFirst(listings) {
    return listings.sort((left, right) => {
        const dateDifference = timestampToMillis(right.createdAt) - timestampToMillis(left.createdAt);
        return dateDifference || String(left.id).localeCompare(String(right.id));
    });
}

/** Fetch public active listings, optionally filtered to one known category. */
export async function getActiveListings({ category, maxResults = 24 } = {}) {
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) {
        throw new RangeError("maxResults must be an integer from 1 to 100.");
    }
    if (category !== undefined && !LISTING_CATEGORIES.includes(category)) {
        throw new TypeError("category must be one of LISTING_CATEGORIES.");
    }

    const listings = await getAllActiveListings();
    const filtered = category === undefined
        ? listings
        : listings.filter((listing) => listing.category === category);
    return newestFirst(filtered).slice(0, maxResults);
}

/** Fetch every active listing in pages, then sort by the stored server timestamp. */
export async function getAllActiveListings() {
    const listings = [];
    let cursor = null;

    while (true) {
        const constraints = [where("status", "==", "active")];
        if (cursor) constraints.push(startAfter(cursor));
        constraints.push(limit(100));

        const page = await getDocs(query(collection(db, LISTINGS_COLLECTION), ...constraints));
        listings.push(...page.docs.map((listingDoc) => ({ id: listingDoc.id, ...listingDoc.data() })));
        if (page.docs.length < 100) return newestFirst(listings);
        cursor = page.docs[page.docs.length - 1];
    }
}

/** Fetch active listings owned by the currently authenticated Firebase user. */
export async function getListingsByOwnerUid(ownerUid) {
    const user = auth.currentUser;
    if (!user || typeof ownerUid !== "string" || ownerUid !== user.uid) {
        const error = new Error("A signed-in owner can only load their own listings.");
        error.code = "auth/unauthorized-listing-owner";
        throw error;
    }

    const snapshot = await getDocs(query(
        collection(db, LISTINGS_COLLECTION),
        where("ownerUid", "==", user.uid)
    ));
    const listings = snapshot.docs
        .map((listingDoc) => ({ id: listingDoc.id, ...listingDoc.data() }))
        .filter((listing) => listing.status === "active");
    return newestFirst(listings);
}

/** Fetch one active listing by document ID; missing or removed listings return null. */
export async function getActiveListingById(listingId) {
    if (typeof listingId !== "string" || listingId.trim() === "" || listingId.includes("/")) {
        throw new TypeError("listingId must be a valid, non-empty document ID.");
    }

    const listingRef = doc(db, LISTINGS_COLLECTION, listingId);
    const result = await getDoc(listingRef);
    if (!result.exists() || result.data().status !== "active") return null;
    return { id: result.id, ...result.data() };
}
