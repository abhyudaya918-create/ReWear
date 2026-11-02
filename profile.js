import { getListingsByOwnerUid } from "./firestore.js";

const grid = document.getElementById("my-listings-grid");
const status = document.getElementById("my-listings-status");
const emptyState = document.getElementById("my-listings-empty");
const defaultImage = "assets/images/listing-placeholder.svg";

function setStatus(message, isError = false) {
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle("is-error", isError);
}

function getImageUrl(listing) {
    if (typeof listing.imageURL === "string" && listing.imageURL.trim()) {
        try {
            const imageUrl = new URL(listing.imageURL, window.location.href);
            if (imageUrl.protocol === "https:" || imageUrl.protocol === "http:") return imageUrl.href;
        } catch (error) {
            // Fall back to the neutral placeholder if the stored URL is malformed.
        }
    }
    return defaultImage;
}

function makeOwnedListingCard(listing) {
    const card = document.createElement("a");
    card.className = "listing-card";
    card.href = `item-details.html?id=${encodeURIComponent(listing.id)}`;
    card.setAttribute("aria-label", `View ${listing.title || "listing"} details`);

    const imageFrame = document.createElement("div");
    imageFrame.className = "listing-image";
    const image = document.createElement("img");
    image.src = getImageUrl(listing);
    image.alt = listing.imageURL ? `Photo of ${listing.title || "listed item"}` : "Placeholder image; no item photo was uploaded";
    image.addEventListener("error", () => {
        image.src = defaultImage;
        image.alt = "Placeholder image; item photo unavailable";
    }, { once: true });
    imageFrame.appendChild(image);

    const info = document.createElement("div");
    info.className = "listing-info";
    const category = document.createElement("p");
    category.className = "listing-category";
    category.textContent = listing.category || "School item";
    const title = document.createElement("h3");
    title.textContent = listing.title || "Untitled item";
    const meta = document.createElement("div");
    meta.className = "listing-meta";
    const condition = document.createElement("span");
    condition.textContent = `${listing.condition || "Condition not provided"} condition`;
    const transaction = document.createElement("span");
    transaction.className = "listing-type";
    transaction.textContent = String(listing.transactionType).toLowerCase() === "exchange" ? "Exchange" : "Free";
    meta.append(condition, transaction);
    info.append(category, title, meta);
    card.append(imageFrame, info);
    return card;
}

async function loadMyListings() {
    try {
        if (typeof window.rewearRequireAuth !== "function") {
            throw new Error("Authentication is not available.");
        }
        const user = await window.rewearRequireAuth("profile.html");
        if (!user) return;

        const listings = await getListingsByOwnerUid(user.uid);
        const cards = document.createDocumentFragment();
        listings.forEach((listing) => cards.appendChild(makeOwnedListingCard(listing)));
        grid.replaceChildren(cards);
        grid.hidden = listings.length === 0;
        emptyState.hidden = listings.length > 0;
        setStatus("");
    } catch (error) {
        console.error("[ReWear] My Listings read failed", { code: error?.code || "unknown" });
        grid.replaceChildren();
        grid.hidden = true;
        emptyState.hidden = true;
        setStatus("Your listings could not be loaded. Please refresh and try again.", true);
    }
}

if (grid && status && emptyState) void loadMyListings();
