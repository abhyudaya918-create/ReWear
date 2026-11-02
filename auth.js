import {
    GoogleAuthProvider,
    browserLocalPersistence,
    getAdditionalUserInfo,
    getRedirectResult,
    onAuthStateChanged,
    setPersistence,
    signInWithPopup,
    signInWithRedirect,
    signOut
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js";
import { auth } from "./firebase-config.js";

const provider = new GoogleAuthProvider();
provider.addScope("email");
provider.setCustomParameters({ prompt: "select_account" });
const returnStorageKey = "rewear-auth-return-to";
const allowedPages = new Set([
    "index.html", "browse.html", "add-listing.html", "item-details.html",
    "liked-items.html", "profile.html"
]);
let currentUser = null;
let signInAttemptStarted = false;
let signingOut = false;
let redirectResultPending = document.body.classList.contains("sign-in-page");
let signInResolutionStarted = false;
let authReadyResolve;
const authReady = new Promise((resolve) => { authReadyResolve = resolve; });
const persistenceReady = setPersistence(auth, browserLocalPersistence);
persistenceReady.catch((error) => {
    console.error("Could not set ReWear sign-in persistence:", { code: error?.code || "unknown" });
});

function safeReturnTarget(value) {
    if (!value) return "index.html";
    try {
        const url = new URL(value, window.location.href);
        const page = url.pathname.split("/").pop();
        if (url.origin !== window.location.origin || !allowedPages.has(page)) return "index.html";
        return `${page}${url.search}${url.hash}`;
    } catch (error) {
        return "index.html";
    }
}

function getRequestedReturnTarget() {
    const queryTarget = new URLSearchParams(window.location.search).get("next");
    let storedTarget = null;
    try {
        storedTarget = window.sessionStorage.getItem(returnStorageKey);
        window.sessionStorage.removeItem(returnStorageKey);
    } catch (error) {
        // The query parameter remains available if session storage is disabled.
    }
    return safeReturnTarget(queryTarget || storedTarget);
}

function setSignInMessage(message, isError = false) {
    const status = document.getElementById("auth-status") || document.getElementById("signout-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-error", isError);
}

function readableAuthError(error) {
    if (error.code === "auth/unauthorized-domain") {
        return "This website address isn't authorized in Firebase yet. Add it to Authentication's authorized domains and try again.";
    }
    if (error.code === "auth/operation-not-allowed") {
        return "Google sign-in isn't enabled for this Firebase project yet.";
    }
    if (error.code === "auth/network-request-failed") {
        return "A network error interrupted sign-in. Check your connection and try again.";
    }
    return "Google sign-in couldn't be completed. Check your connection and Firebase settings, then try again.";
}

function getGoogleProviderProfile(user) {
    return user?.providerData?.find((profile) => profile.providerId === "google.com") || null;
}

async function logAuthIdentityDiagnostics(source, user, signInResult = null) {
    let claims = null;
    let tokenClaimsRead = false;
    if (user) {
        try {
            claims = (await user.getIdTokenResult()).claims;
            tokenClaimsRead = true;
        } catch (error) {
            // Diagnostics must never include token contents or credential data.
        }
    }
    const googleProfile = getGoogleProviderProfile(user);
    const isNewFirebaseUser = signInResult ? getAdditionalUserInfo(signInResult)?.isNewUser === true : false;
    const sameAuthAccount = Boolean(user && auth.currentUser?.uid === user.uid);
    const emailMatchesToken = Boolean(user?.email && claims?.email && user.email === claims.email);
    console.info("[ReWear] Auth identity diagnostics", {
        firebaseProjectId: auth.app.options.projectId,
        popupResultObserved: source === "google-popup-result",
        redirectResultObserved: source === "google-redirect-result",
        authStateListenerObserved: source === "auth-state-listener",
        authStateInitialized: true,
        isNewFirebaseUser,
        userPresent: Boolean(user),
        currentUserPresent: Boolean(auth.currentUser),
        sameUserObjectAsCurrentAuthUser: Boolean(user && auth.currentUser === user),
        sameUidAsCurrentAuthUser: sameAuthAccount,
        signInResultPresent: Boolean(signInResult),
        signInResultMatchesCurrentAuthUser: Boolean(signInResult && sameAuthAccount && signInResult.user.uid === user?.uid),
        firebaseEmailPresent: Boolean(user?.email),
        googleProviderPresent: Boolean(googleProfile),
        googleProviderEmailPresent: Boolean(googleProfile?.email),
        tokenClaimsRead,
        tokenEmailClaimPresent: Boolean(claims?.email),
        tokenEmailVerifiedClaimPresent: typeof claims?.email_verified === "boolean",
        tokenEmailVerified: claims?.email_verified === true,
        firebaseEmailMatchesToken: emailMatchesToken
    });
    // Sign-in establishes identity; an email claim is required later by
    // createListing, where the verification flow can repair a missing primary email.
    return Boolean(sameAuthAccount && googleProfile);
}

async function acceptGoogleSignIn(user, signInResult = null, source = "auth-state-listener") {
    const usable = await logAuthIdentityDiagnostics(source, user, signInResult);
    if (!usable) {
        try {
            await signOut(auth);
        } catch (error) {
            // The Add Listing flow independently blocks users without a matching email claim.
        }
        setSignInMessage("Google sign-in could not be matched to the current Firebase account. Please try again.", true);
        return false;
    }

    window.location.replace(getRequestedReturnTarget());
    return true;
}

function showUser(user) {
    const googleProfile = getGoogleProviderProfile(user);
    const displayName = user?.displayName || googleProfile?.displayName || "ReWear member";
    const email = user?.email || googleProfile?.email || "";
    const photoURL = user?.photoURL || googleProfile?.photoURL;
    const profileLink = document.querySelector(".profile-link");
    if (profileLink && document.body.classList.contains("profile-page")) {
        profileLink.setAttribute("aria-current", "page");
    }
    document.querySelectorAll("[data-auth-avatar]").forEach((avatar) => {
        avatar.replaceChildren();
        if (photoURL) {
            const image = document.createElement("img");
            image.src = photoURL;
            image.alt = "";
            image.referrerPolicy = "no-referrer";
            avatar.appendChild(image);
        } else {
            const name = displayName || email || "ReWear member";
            avatar.textContent = name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
        }
        avatar.setAttribute("aria-label", user ? `${displayName || email} profile` : "Profile");
    });

    document.querySelectorAll("[data-auth-signin]").forEach((link) => { link.hidden = Boolean(user); });
    document.querySelectorAll("[data-auth-signout]").forEach((button) => { button.hidden = !user; });
    document.querySelectorAll("[data-auth-user-name]").forEach((node) => {
        node.textContent = user ? displayName : "ReWear member";
    });
    document.querySelectorAll("[data-auth-user-email]").forEach((node) => {
        node.textContent = user ? email : "";
    });
    document.querySelectorAll("[data-auth-user-photo]").forEach((node) => {
        node.replaceChildren();
        if (photoURL) {
            const image = document.createElement("img");
            image.src = photoURL;
            image.alt = "";
            image.referrerPolicy = "no-referrer";
            node.appendChild(image);
        } else {
            node.textContent = user ? displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() : "RW";
        }
    });
}

function redirectToSignIn(returnTarget) {
    const currentPage = `${window.location.pathname.split("/").pop()}${window.location.search}${window.location.hash}`;
    const requested = safeReturnTarget(returnTarget || currentPage);
    window.location.href = `sign-in.html?next=${encodeURIComponent(requested)}`;
}

// Shared guard for actions that require an authenticated user.
window.rewearRequireAuth = async function (returnTarget) {
    await authReady;
    if (currentUser) return currentUser;
    redirectToSignIn(returnTarget);
    return null;
};

document.querySelectorAll('a[href="add-listing.html"]').forEach((link) => {
    link.addEventListener("click", async (event) => {
        event.preventDefault();
        if (await window.rewearRequireAuth("add-listing.html")) window.location.href = "add-listing.html";
    });
});

document.querySelectorAll("[data-auth-signout]").forEach((button) => {
    button.addEventListener("click", async () => {
        const originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = "Signing out…";
        signingOut = true;
        try {
            await signOut(auth);
            window.location.href = "index.html";
        } catch (error) {
            signingOut = false;
            button.disabled = false;
            button.textContent = originalLabel;
            console.error("ReWear sign-out failed:", { code: error?.code || "unknown" });
            setSignInMessage("We couldn't sign you out. Please try again.", true);
        }
    });
});

const signInButton = document.getElementById("google-sign-in");
if (signInButton) {
    signInButton.addEventListener("click", async () => {
        signInAttemptStarted = true;
        signInButton.disabled = true;
        signInButton.setAttribute("aria-busy", "true");
        setSignInMessage("Connecting to Google…");
        try {
            await persistenceReady;
            const signInResult = await signInWithPopup(auth, provider);
            const accepted = await acceptGoogleSignIn(signInResult.user, signInResult, "google-popup-result");
            if (!accepted) {
                signInButton.disabled = false;
                signInButton.removeAttribute("aria-busy");
            }
        } catch (error) {
            if (error.code === "auth/popup-blocked") {
                try {
                    window.sessionStorage.setItem(returnStorageKey, getRequestedReturnTarget());
                    await signInWithRedirect(auth, provider);
                    return;
                } catch (redirectError) {
                    setSignInMessage("Your browser blocked the sign-in window. Allow pop-ups and try again.", true);
                }
            } else if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") {
                setSignInMessage("Sign-in was cancelled. Choose Continue with Google when you're ready.");
            } else {
                console.error("ReWear Google sign-in failed:", { code: error?.code || "unknown" });
                setSignInMessage(readableAuthError(error), true);
            }
            signInButton.disabled = false;
            signInButton.removeAttribute("aria-busy");
        }
    });
}

onAuthStateChanged(auth, (user) => {
    currentUser = user;
    showUser(user);
    authReadyResolve(user);
    void logAuthIdentityDiagnostics("auth-state-listener", user);

    if (document.body.classList.contains("profile-page") && !user && !signingOut) {
        redirectToSignIn();
        return;
    }
}, (error) => {
    console.error("ReWear authentication state could not be loaded:", { code: error?.code || "unknown" });
    currentUser = null;
    authReadyResolve(null);
    setSignInMessage("We couldn't check your sign-in status. Refresh the page and try again.", true);
});

// Capture the actual OAuth result after a redirect sign-in as well. The auth-state
// listener remains the source used by page guards; this is diagnostic only.
if (document.body.classList.contains("sign-in-page")) {
    getRedirectResult(auth)
        .then((result) => {
            if (result?.user) {
                signInResolutionStarted = true;
                return acceptGoogleSignIn(result.user, result, "google-redirect-result");
            }
            return undefined;
        })
        .catch((error) => {
            console.info("[ReWear] Google redirect result diagnostics", {
                firebaseProjectId: auth.app.options.projectId,
                redirectResultAvailable: false,
                errorCodePresent: Boolean(error?.code)
            });
        })
        .finally(() => {
            redirectResultPending = false;
            void authReady.then(() => {
                if (currentUser && !signInAttemptStarted && !signInResolutionStarted) {
                    signInResolutionStarted = true;
                    void acceptGoogleSignIn(currentUser);
                }
            });
        });
}
