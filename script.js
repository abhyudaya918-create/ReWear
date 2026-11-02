import {
    getActiveListingById,
    getActiveListings,
    getAllActiveListings
} from "./firestore.js";

// Legacy preview examples remain available for the two preset liked items.
const listingExamples = {
    "physics-textbook": {
        name: "Physics Textbook",
        image: "assets/images/school-books.jpg",
        imageAlt: "A stack of school books",
        category: "Textbooks / Workbooks",
        condition: "Good",
        transaction: "Free",
        description: "Year 10 Physics textbook in good condition. The pages are clean and the chapters are intact, with a few light signs of use on the cover.",
        conditionExplanation: "Good condition means the item has been used carefully and has only light signs of wear.",
        owner: "Aarav M.",
        ownerEmail: "aarav.m@example.com",
        initials: "AM"
    },
    "school-backpack": {
        name: "School Backpack",
        image: "assets/images/school-backpack.jpg",
        imageAlt: "A yellow school backpack",
        category: "School Bags / Lunchboxes",
        condition: "Good",
        transaction: "Exchange",
        description: "A sturdy school backpack with working zips and a roomy main pocket. It has been used but is still in good, clean condition.",
        conditionExplanation: "Good condition means the item is clean, usable, and has only light signs of wear.",
        owner: "Mira K.",
        ownerEmail: "mira.k@example.com",
        initials: "MK"
    },
    "art-supplies": {
        name: "Art Supplies",
        image: "assets/images/art-supplies.jpg",
        imageAlt: "Art supplies on a table",
        category: "Art & Craft Supplies",
        condition: "Medium",
        transaction: "Free",
        description: "A collection of art supplies for class projects. Some pieces have been used, while the rest are ready for another student.",
        conditionExplanation: "Medium condition means the item shows visible signs of use but remains usable.",
        owner: "Riya S.",
        ownerEmail: "riya.s@example.com",
        initials: "RS"
    },
    "basketball": {
        name: "Basketball",
        image: "assets/images/basketball.jpg",
        imageAlt: "Basketball on an outdoor court",
        category: "Sports Equipment",
        condition: "Good",
        transaction: "Exchange",
        description: "A school basketball in good condition. It has been used for practice and is ready to be used again.",
        conditionExplanation: "Good condition means the item is ready to use and has only light signs of wear.",
        owner: "Kabir D.",
        ownerEmail: "kabir.d@example.com",
        initials: "KD"
    },
    "geometry-set": {
        name: "Geometry Set",
        image: "assets/images/school-stationery.jpg",
        imageAlt: "School stationery on a desk",
        category: "Stationery",
        condition: "Good",
        transaction: "Exchange",
        description: "A geometry set with the main tools for class, kept together in its case. The case has light signs of use.",
        conditionExplanation: "Good condition means the set is complete and usable, with only light signs of wear.",
        owner: "Anaya P.",
        ownerEmail: "anaya.p@example.com",
        initials: "AP"
    },
    "pe-kit": {
        name: "PE Kit",
        image: "assets/images/school-backpack.jpg",
        imageAlt: "Placeholder photo for a PE kit",
        category: "Uniforms / PE Kits",
        condition: "Medium",
        transaction: "Free",
        description: "A pre-loved PE kit in usable condition. Please check the item carefully to make sure the size and condition suit you.",
        conditionExplanation: "Medium condition means the item has visible signs of use but remains usable.",
        owner: "Dev R.",
        ownerEmail: "dev.r@example.com",
        initials: "DR"
    },
    "scientific-calculator": {
        name: "Scientific Calculator",
        image: "assets/images/school-stationery.jpg",
        imageAlt: "Placeholder photo for a scientific calculator",
        category: "Electronics",
        condition: "Good",
        transaction: "Exchange",
        description: "A school scientific calculator in good condition, with its buttons and display working as expected.",
        conditionExplanation: "Good condition means the calculator is usable and has only light signs of wear.",
        owner: "Neel J.",
        ownerEmail: "neel.j@example.com",
        initials: "NJ"
    },
    "lunchbox": {
        name: "Lunchbox",
        image: "assets/images/school-backpack.jpg",
        imageAlt: "Placeholder photo for a school lunchbox",
        category: "School Bags / Lunchboxes",
        condition: "Good",
        transaction: "Free",
        description: "A clean, reusable lunchbox with a secure lid. It has been used carefully and is ready for another school day.",
        conditionExplanation: "Good condition means the lunchbox is clean, usable, and has only light signs of wear.",
        owner: "Tara L.",
        ownerEmail: "tara.l@example.com",
        initials: "TL"
    }
};

const savedItemsStorageKey = "rewear-saved-items";
const starterSavedItems = ["basketball", "geometry-set"];
const defaultListingImage = "assets/images/listing-placeholder.svg";

function isValidListingId(id) {
    return typeof id === "string" && id.trim().length > 0 && id.length <= 1500 && !id.includes("/");
}

function isValidSavedId(id) {
    if (typeof id !== "string") return false;
    if (id.startsWith("sample:")) return Object.prototype.hasOwnProperty.call(listingExamples, id.slice(7));
    if (id.startsWith("firestore:")) return isValidListingId(id.slice(10));
    return isValidListingId(id);
}

function getSavedItemIds() {
    try {
        const storedItems = window.localStorage.getItem(savedItemsStorageKey);
        if (storedItems === null) {
            window.localStorage.setItem(savedItemsStorageKey, JSON.stringify(starterSavedItems));
            return [...starterSavedItems];
        }

        const parsedItems = JSON.parse(storedItems);
        if (!Array.isArray(parsedItems)) return [];

        return [...new Set(parsedItems.filter(isValidSavedId))];
    } catch (error) {
        // Keep the two sample saved items available if browser storage is blocked.
        return [...starterSavedItems];
    }
}

function storeSavedItemIds(itemIds) {
    try {
        window.localStorage.setItem(savedItemsStorageKey, JSON.stringify(itemIds));
    } catch (error) {
        // This project has no server storage; this is only a local UI feature.
    }
}

function exampleAsListing(id, item) {
    return {
        id: `sample:${id}`,
        sampleId: id,
        source: "sample",
        title: item.name,
        category: item.category,
        condition: item.condition,
        description: item.description,
        transactionType: item.transaction.toLowerCase(),
        ownerName: item.owner,
        ownerEmail: item.ownerEmail,
        imageURL: item.image
    };
}

function getSampleListings() {
    return Object.entries(listingExamples).map(([id, item]) => exampleAsListing(id, item));
}

function combineRealAndSampleListings(realListings, sampleListings, maxResults = Infinity) {
    const realIds = new Set(realListings.map((listing) => listing.id));
    const samples = sampleListings.filter((listing) => {
        return !realIds.has(listing.sampleId) && !realIds.has(listing.id);
    });
    return [
        ...realListings.map((listing) => ({ ...listing, source: "firestore" })),
        ...samples
    ].slice(0, maxResults);
}

function savedIdForListing(listing) {
    return listing.source === "sample" ? `sample:${listing.sampleId}` : `firestore:${listing.id}`;
}

function isListingSaved(savedIds, listing) {
    const savedId = savedIdForListing(listing);
    if (savedIds.includes(savedId)) return true;
    // Read old localStorage entries written before IDs were source-namespaced.
    return listing.source === "sample"
        ? savedIds.includes(listing.sampleId)
        : savedIds.includes(listing.id);
}

function transactionLabel(value) {
    return String(value || "").toLowerCase() === "exchange" ? "Exchange" : "Free";
}

function listingImageUrl(listing) {
    if (typeof listing.imageURL === "string" && listing.imageURL.trim()) {
        try {
            const url = new URL(listing.imageURL, window.location.href);
            if (url.protocol === "https:" || url.protocol === "http:") return url.href;
        } catch (error) {
            // Use the existing local category placeholder for malformed image URLs.
        }
    }
    return defaultListingImage;
}

function conditionExplanation(condition) {
    const explanations = {
        Good: "Good condition means the item has been used carefully and has only light signs of wear.",
        Medium: "Medium condition means the item shows visible signs of use but remains usable.",
        Poor: "Poor condition means the item has noticeable wear and should be checked carefully before use."
    };
    return explanations[condition] || "Check the item's condition carefully before arranging an exchange.";
}

function makeListingCard(listing) {
    const card = document.createElement("a");
    card.className = "listing-card";
    card.href = listing.source === "sample"
        ? `item-details.html?sample=${encodeURIComponent(listing.sampleId)}`
        : `item-details.html?id=${encodeURIComponent(listing.id)}`;
    card.setAttribute("aria-label", `View ${listing.title || "listing"} details`);
    card.dataset.title = listing.title || "";
    card.dataset.category = listing.category || "";
    card.dataset.condition = listing.condition || "";
    card.dataset.search = [listing.title, listing.category, listing.description, listing.ownerName]
        .filter(Boolean).join(" ").toLocaleLowerCase();

    const imageFrame = document.createElement("div");
    imageFrame.className = "listing-image";
    const image = document.createElement("img");
    image.src = listingImageUrl(listing);
    image.alt = listing.imageURL ? `Photo of ${listing.title || "listed item"}` : `Placeholder image for ${listing.category || "school item"}`;
    image.addEventListener("error", () => {
        image.src = defaultListingImage;
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
    transaction.textContent = transactionLabel(listing.transactionType);
    meta.append(condition, transaction);
    info.append(category, title, meta);

    if (listing.source === "sample") {
        const sampleTag = document.createElement("span");
        sampleTag.className = "listing-status";
        sampleTag.textContent = "Sample";
        info.appendChild(sampleTag);
    }

    if (listing.ownerName) {
        const owner = document.createElement("p");
        owner.className = "listing-owner";
        owner.textContent = `Shared by ${listing.ownerName}`;
        info.appendChild(owner);
    }

    card.append(imageFrame, info);
    return card;
}

function renderListingCards(grid, listings) {
    const fragment = document.createDocumentFragment();
    listings.forEach((listing) => fragment.appendChild(makeListingCard(listing)));
    grid.replaceChildren(fragment);
}

function setListingStatus(node, message = "", isError = false) {
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
    node.classList.toggle("is-error", isError);
}

// Home shows the same eight-card footprint as the previous static layout.
const homeGrid = document.getElementById("recent-listings-grid");
if (homeGrid) {
    const status = document.getElementById("home-listings-status");
    const search = document.getElementById("home-search");
    let recentListings = [];
    const samples = getSampleListings();
    let readFailed = false;

    function applyHomeSearch() {
        const composed = combineRealAndSampleListings(recentListings, samples, 8);
        const term = (search?.value || "").trim().toLocaleLowerCase();
        const filtered = composed.filter((listing) => {
            return !term || [listing.title, listing.category, listing.description, listing.ownerName]
                .filter(Boolean).join(" ").toLocaleLowerCase().includes(term);
        });
        renderListingCards(homeGrid, filtered);
        const message = filtered.length === 0
            ? (term ? "No recent listings match your search." : "No listings are available yet.")
            : readFailed
                ? "Live listings could not be loaded; showing sample listings."
                : recentListings.length < 8
                    ? "Sample listings fill the remaining spaces."
                    : "";
        setListingStatus(status, message, readFailed);
    }

    search?.addEventListener("input", applyHomeSearch);
    getActiveListings({ maxResults: 8 })
        .then((listings) => {
            recentListings = listings;
            applyHomeSearch();
        })
        .catch((error) => {
            console.error("[ReWear] Home listings read failed", { code: error?.code || "unknown" });
            readFailed = true;
            applyHomeSearch();
        });
}

// Browse loads all active records in pages and retains the existing search and filters.
const browseGrid = document.getElementById("browse-listings-grid");
if (browseGrid) {
    const status = document.getElementById("browse-listings-status");
    const search = document.getElementById("browse-search");
    const categoryFilter = document.getElementById("browse-category");
    const conditionFilter = document.getElementById("browse-condition");
    let allListings = [];
    const samples = getSampleListings();
    let readFailed = false;

    function applyBrowseFilters() {
        const composed = combineRealAndSampleListings(allListings, samples);
        const term = (search?.value || "").trim().toLocaleLowerCase();
        const selectedCategory = categoryFilter?.value === "All categories" ? "" : categoryFilter?.value || "";
        const selectedCondition = conditionFilter?.value === "All conditions" ? "" : conditionFilter?.value || "";
        const filtered = composed.filter((listing) => {
            const matchesSearch = !term || [listing.title, listing.category, listing.description, listing.ownerName]
                .filter(Boolean).join(" ").toLocaleLowerCase().includes(term);
            return matchesSearch && (!selectedCategory || listing.category === selectedCategory) &&
                (!selectedCondition || listing.condition === selectedCondition);
        });
        renderListingCards(browseGrid, filtered);
        const message = filtered.length === 0
            ? "No listings match those filters."
            : readFailed
                ? "Live listings could not be loaded; showing sample listings."
                : samples.length ? "Sample listings are shown after live listings." : "";
        setListingStatus(status, message, readFailed);
    }

    search?.addEventListener("input", applyBrowseFilters);
    categoryFilter?.addEventListener("change", applyBrowseFilters);
    conditionFilter?.addEventListener("change", applyBrowseFilters);
    getAllActiveListings()
        .then((listings) => {
            allListings = listings;
            applyBrowseFilters();
        })
        .catch((error) => {
            console.error("[ReWear] Browse listings read failed", { code: error?.code || "unknown" });
            readFailed = true;
            applyBrowseFilters();
        });
}

// Load a real active listing by its Firestore document ID. Legacy example IDs
// remain supported for the original preset liked items.
const detailsPage = document.querySelector("[data-item-details]");

if (detailsPage) {
    const status = document.getElementById("item-details-status");
    const detailsLayout = detailsPage.querySelector(".details-layout");
    const detailsNotes = detailsPage.querySelector(".details-bottom-notes");
    const detailsParams = new URLSearchParams(window.location.search);
    const requestedId = detailsParams.get("id");
    const requestedSampleId = detailsParams.get("sample");

    async function renderItemDetails(listing) {
        detailsLayout.hidden = false;
        detailsNotes.hidden = false;
        setListingStatus(status);
        document.getElementById("item-title").textContent = listing.title || "Untitled item";
        const image = document.getElementById("item-image");
        image.src = listingImageUrl(listing);
        image.alt = listing.imageURL ? `Photo of ${listing.title || "listed item"}` : `Placeholder image for ${listing.category || "school item"}`;
        image.addEventListener("error", () => {
            image.src = defaultListingImage;
        }, { once: true });
        document.getElementById("item-category").textContent = listing.category || "School item";
        document.getElementById("item-condition").textContent = `${listing.condition || "Condition not provided"} condition`;
        document.getElementById("item-transaction").textContent = transactionLabel(listing.transactionType);
        document.getElementById("item-description").textContent = listing.description || "No description was provided.";
        document.getElementById("condition-explanation").textContent = conditionExplanation(listing.condition);

        const ownerName = listing.ownerName || "ReWear member";
        document.getElementById("owner-name").textContent = ownerName;
        document.getElementById("owner-initials").textContent = ownerName.split(/\s+/).filter(Boolean).slice(0, 2)
            .map((part) => part[0]).join("").toUpperCase() || "RW";

        const contactButton = document.getElementById("contact-owner");
        const ownerContact = document.getElementById("owner-contact");
        const contactNote = document.getElementById("contact-note");
        const ownerEmail = typeof listing.ownerEmail === "string" ? listing.ownerEmail : "";
        ownerContact.hidden = true;
        if (ownerEmail) {
            contactButton.hidden = false;
            contactNote.hidden = false;
            document.getElementById("owner-email").textContent = ownerEmail;
            contactButton.setAttribute("aria-expanded", "false");
            contactButton.onclick = () => {
                const isExpanded = contactButton.getAttribute("aria-expanded") === "true";
                contactButton.setAttribute("aria-expanded", String(!isExpanded));
                ownerContact.hidden = isExpanded;
            };
            document.getElementById("copy-owner-email").onclick = async () => {
                const copyStatus = document.getElementById("copy-email-status");
                try {
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(ownerEmail);
                    } else {
                        const temporaryField = document.createElement("textarea");
                        temporaryField.value = ownerEmail;
                        temporaryField.setAttribute("readonly", "");
                        temporaryField.style.position = "fixed";
                        temporaryField.style.opacity = "0";
                        document.body.appendChild(temporaryField);
                        temporaryField.select();
                        const copied = document.execCommand("copy");
                        temporaryField.remove();
                        if (!copied) throw new Error("Clipboard copy unavailable");
                    }
                    copyStatus.textContent = "Email copied.";
                } catch (error) {
                    copyStatus.textContent = "Copy unavailable. Select the email address to copy it.";
                }
            };
        } else {
            contactButton.hidden = true;
            contactNote.hidden = true;
        }

        const saveButton = document.getElementById("save-item");
        let savedItemIds = getSavedItemIds();
        function updateSaveButton(isSaved) {
            saveButton.setAttribute("aria-pressed", String(isSaved));
            saveButton.classList.toggle("is-saved", isSaved);
            saveButton.querySelector(".save-heart").textContent = isSaved ? "♥" : "♡";
            saveButton.querySelector(".save-label").textContent = isSaved ? "Saved" : "Save item";
        }
        updateSaveButton(isListingSaved(savedItemIds, listing));
        saveButton.onclick = async () => {
            if (typeof window.rewearRequireAuth !== "function") {
                window.location.href = `sign-in.html?next=${encodeURIComponent(window.location.pathname.split("/").pop() + window.location.search + window.location.hash)}`;
                return;
            }
            if (!(await window.rewearRequireAuth())) return;
            const savedKey = savedIdForListing(listing);
            const isSaved = isListingSaved(savedItemIds, listing);
            const legacyKey = listing.source === "sample" ? listing.sampleId : listing.id;
            savedItemIds = isSaved
                ? savedItemIds.filter((savedId) => savedId !== savedKey && savedId !== legacyKey)
                : [...savedItemIds, savedKey];
            storeSavedItemIds(savedItemIds);
            updateSaveButton(!isSaved);
        };
    }

    if (requestedSampleId !== null) {
        const example = listingExamples[requestedSampleId];
        if (example) renderItemDetails(exampleAsListing(requestedSampleId, example));
        else setListingStatus(status, "This sample listing was not found.", true);
    } else if (!requestedId || !isValidListingId(requestedId)) {
        setListingStatus(status, "No valid listing ID was provided.", true);
    } else {
        getActiveListingById(requestedId)
            .then((listing) => {
                if (listing) return renderItemDetails(listing);
                setListingStatus(status, "This listing was not found or is no longer active.", true);
            })
            .catch((error) => {
                if (error.code === "permission-denied") {
                    setListingStatus(status, "This listing was not found or is no longer active.", true);
                } else {
                    setListingStatus(status, "This listing could not be loaded. Please try again.", true);
                }
            });
    }
}

const likedItemsGrid = document.getElementById("liked-listing-grid");

if (likedItemsGrid) {
    const savedItemsView = document.getElementById("saved-items-view");
    const emptySavedState = document.getElementById("empty-saved-state");
    const savedItemIds = getSavedItemIds();
    const status = document.getElementById("liked-listings-status");
    let savedLookupFailed = false;
    Promise.all(savedItemIds.map(async (savedId) => {
        try {
            if (savedId.startsWith("sample:")) {
                const sampleId = savedId.slice(7);
                const sample = listingExamples[sampleId];
                return sample ? exampleAsListing(sampleId, sample) : null;
            }

            if (savedId.startsWith("firestore:")) {
                const firestoreId = savedId.slice(10);
                const listing = await getActiveListingById(firestoreId);
                return listing ? { ...listing, source: "firestore" } : null;
            }

            // Resolve legacy unprefixed IDs written by the original sample UI.
            const legacyListing = await getActiveListingById(savedId);
            if (legacyListing) return { ...legacyListing, source: "firestore" };
            const example = listingExamples[savedId];
            return example ? exampleAsListing(savedId, example) : null;
        } catch (error) {
            // Keep legacy sample favorites available if a stale ID fails to read.
            savedLookupFailed = true;
            if (!savedId.startsWith("firestore:") && !savedId.startsWith("sample:")) {
                const example = listingExamples[savedId];
                if (example) return exampleAsListing(savedId, example);
            }
            return null;
        }
    })).then((results) => {
        const listings = results.filter(Boolean);
        renderListingCards(likedItemsGrid, listings);
        const hasSavedItems = listings.length > 0;
        savedItemsView.hidden = !hasSavedItems;
        emptySavedState.hidden = hasSavedItems || savedLookupFailed;
        setListingStatus(status, savedLookupFailed
            ? "Some saved listings could not be loaded. They may be removed or temporarily unavailable."
            : "");
    }).catch(() => {
        savedItemsView.hidden = true;
        emptySavedState.hidden = false;
        setListingStatus(status, "Saved listings could not be loaded. Please try again.", true);
    });
}
