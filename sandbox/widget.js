(function () {
    "use strict";

    var REGISTRATION_MODULE = "Event_Registrations";
    var EVENT_MODULE = "Party_Events";
    var PAGE_SIZE = 50;
    var API_PAGE_SIZE = 200;
    var MAX_API_PAGES = 50;
    var REQUEST_TIMEOUT_MS = 20000;
    var SAVE_BATCH_SIZE = 100;

    var MODULES = {
        families: {
            entity: "Families",
            statusField: "Family_Status",
            statusLabel: "Family Status",
            statuses: [
                { label: "New", values: ["New"] },
                { label: "Accepted", values: ["Accepted"] },
                { label: "Provisional", values: ["Provisional Acceptance", "Provisional"] },
                { label: "Inactive", values: ["Inactive"] },
                { label: "Rejected", values: ["Rejected"] },
                { label: "Form Re-Submitted", values: ["Form Submitted", "Form Re-Submitted"] },
                { label: "New Submission", values: ["New Submission"] }
            ]
        },
        patients: {
            entity: "Patientt",
            statusField: "Status",
            statusLabel: "Status",
            statuses: [
                { label: "New", values: ["New"] },
                { label: "Review", values: ["Review"] },
                { label: "Accepted", values: ["Active", "Accepted"] },
                { label: "Provisional Acceptance", values: ["Provisional Acceptance"] },
                { label: "Pending", values: ["Pending"] },
                { label: "On Hold", values: ["On Hold"] },
                { label: "Rejected", values: ["Not Approved", "Rejected"] },
                { label: "Inactive", values: ["Inactive"] }
            ]
        },
        volunteers: {
            entity: "Volunteers",
            statusField: "Volunteer_Status",
            statusLabel: "Volunteer Status",
            statuses: [
                { label: "New", values: ["New"] },
                { label: "Active", values: ["Active"] },
                { label: "Center", values: ["Center"] },
                { label: "Not Active", values: ["Not Active"] },
                { label: "Not Approved", values: ["Declined", "Not Approved"] }
            ]
        }
    };

    var state = {
        eventId: "",
        eventName: "Event",
        activeTab: "patients",
        page: 1,
        search: "",
        statusFilters: {
            families: "",
            patients: "",
            volunteers: ""
        },
        records: [],
        totalFiltered: 0,
        moreRecords: false,
        loading: false,
        saving: false,
        removing: false,
        removingRegistrationId: "",
        started: false,
        requestNumber: 0,
        selected: new Map(),
        allRecords: {
            families: null,
            patients: null,
            volunteers: null
        },
        registrationIds: new Map(),
        eventContextLoaded: false
    };

    var elements = {};

    function byId(id) {
        return document.getElementById(id);
    }

    function cacheElements() {
        elements.app = byId("app");
        elements.eventName = byId("event-name");
        elements.selectPageButton = byId("select-page-button");
        elements.clearSelectionButton = byId("clear-selection-button");
        elements.searchForm = byId("search-form");
        elements.searchInput = byId("search-input");
        elements.statusFilter = byId("status-filter");
        elements.resultSummary = byId("result-summary");
        elements.selectionSummary = byId("selection-summary");
        elements.loadingState = byId("loading-state");
        elements.loadingText = byId("loading-text");
        elements.errorState = byId("error-state");
        elements.errorMessage = byId("error-message");
        elements.retryButton = byId("retry-button");
        elements.emptyState = byId("empty-state");
        elements.emptyMessage = byId("empty-message");
        elements.tableContainer = byId("table-container");
        elements.tableHead = byId("table-head");
        elements.tableBody = byId("table-body");
        elements.pageLabel = byId("page-label");
        elements.previousButton = byId("previous-button");
        elements.nextButton = byId("next-button");
        elements.notice = byId("notice");
        elements.doneButton = byId("done-button");
        elements.saveButton = byId("save-button");
        elements.tabButtons = Array.prototype.slice.call(
            document.querySelectorAll(".tab-button")
        );
    }

    function addEventListeners() {
        elements.tabButtons.forEach(function (button) {
            button.addEventListener("click", function () {
                changeTab(button.getAttribute("data-tab"));
            });
        });

        elements.searchForm.addEventListener("submit", function (event) {
            event.preventDefault();
            applySearch();
        });

        elements.searchInput.addEventListener("search", function () {
            if (String(elements.searchInput.value || "").trim() === "") {
                clearSearch();
            }
        });

        elements.statusFilter.addEventListener("change", function () {
            if (state.saving || state.removing || state.loading) {
                return;
            }
            state.statusFilters[state.activeTab] = String(elements.statusFilter.value || "");
            state.page = 1;
            applyLocalFilters();
        });

        elements.selectPageButton.addEventListener("click", selectCurrentPage);
        elements.clearSelectionButton.addEventListener("click", clearSelection);
        elements.retryButton.addEventListener("click", function () {
            loadPage();
        });
        elements.previousButton.addEventListener("click", previousPage);
        elements.nextButton.addEventListener("click", nextPage);
        elements.saveButton.addEventListener("click", saveRegistrations);
        elements.doneButton.addEventListener("click", closeWidget);
    }

    function initialize() {
        cacheElements();
        addEventListeners();
        populateStatusFilter();
        render();

        if (!window.ZOHO || !ZOHO.embeddedApp) {
            showFatalError(
                "The Zoho Widget SDK did not load. Open this widget from its CRM button."
            );
            return;
        }

        ZOHO.embeddedApp.on("PageLoad", function (pageData) {
            startFromPageData(pageData || {});
        });

        ZOHO.embeddedApp.init();

        window.setTimeout(function () {
            if (!state.started) {
                var queryId = getQueryEventId();
                if (queryId) {
                    startWithEventId(queryId);
                } else {
                    showFatalError(
                        "No Party Event ID was received. Connect this widget to a button on the Party Events detail page."
                    );
                }
            }
        }, 8000);
    }

    function getQueryEventId() {
        var params = new URLSearchParams(window.location.search);
        return String(params.get("event_id") || "").trim();
    }

    function startFromPageData(pageData) {
        var candidate =
            pageData.EntityId ||
            pageData.EntityID ||
            pageData.RecordID ||
            pageData.record_id ||
            pageData.id ||
            "";

        if (Array.isArray(candidate)) {
            candidate = candidate.length > 0 ? candidate[0] : "";
        }

        candidate = String(candidate || "").trim();

        if (!candidate) {
            candidate = getQueryEventId();
        }

        if (!candidate) {
            showFatalError(
                "Zoho opened the widget without an Event ID. The button must be a detail-page button in Party Events."
            );
            return;
        }

        startWithEventId(candidate);
    }

    function startWithEventId(eventId) {
        if (state.started && state.eventId === eventId) {
            return;
        }

        state.started = true;
        state.eventId = eventId;
        state.eventName = "Event";
        state.page = 1;
        state.search = "";
        state.records = [];
        state.totalFiltered = 0;
        state.moreRecords = false;
        state.selected.clear();
        state.allRecords.families = null;
        state.allRecords.patients = null;
        state.allRecords.volunteers = null;
        state.registrationIds.clear();
        state.eventContextLoaded = false;
        state.statusFilters.families = "";
        state.statusFilters.patients = "";
        state.statusFilters.volunteers = "";
        elements.searchInput.value = "";
        populateStatusFilter();
        clearNotice();
        loadPage();
    }

    function withTimeout(promise, milliseconds, message) {
        return new Promise(function (resolve, reject) {
            var finished = false;
            var timer = window.setTimeout(function () {
                if (!finished) {
                    finished = true;
                    reject(new Error(message));
                }
            }, milliseconds);

            Promise.resolve(promise).then(
                function (value) {
                    if (!finished) {
                        finished = true;
                        window.clearTimeout(timer);
                        resolve(value);
                    }
                },
                function (error) {
                    if (!finished) {
                        finished = true;
                        window.clearTimeout(timer);
                        reject(error);
                    }
                }
            );
        });
    }

    function extractRecords(response) {
        if (Array.isArray(response)) {
            return response;
        }
        if (response && Array.isArray(response.data)) {
            return response.data;
        }
        if (response && response.data && Array.isArray(response.data.data)) {
            return response.data.data;
        }
        return [];
    }

    function responseHasMore(response, records) {
        if (response && response.info && response.info.more_records !== undefined) {
            return response.info.more_records === true;
        }
        if (
            response &&
            response.data &&
            response.data.info &&
            response.data.info.more_records !== undefined
        ) {
            return response.data.info.more_records === true;
        }
        return records.length === API_PAGE_SIZE;
    }

    async function loadEventContext() {
        if (state.eventContextLoaded) {
            return;
        }

        var eventResponse = await withTimeout(
            ZOHO.CRM.API.getRecord({
                Entity: EVENT_MODULE,
                RecordID: state.eventId
            }),
            REQUEST_TIMEOUT_MS,
            "Zoho took too long while loading the Event."
        );

        var eventRecords = extractRecords(eventResponse);
        if (!eventRecords.length) {
            throw new Error("Event record was not found.");
        }

        state.eventName = String(eventRecords[0].Name || "Event");
        await loadRegistrationsForEvent();
        state.eventContextLoaded = true;
    }

    async function loadRegistrationsForEvent() {
        var registrations = [];
        var page = 1;
        var criteria = "(Event:equals:" + state.eventId + ")";

        try {
            while (page <= MAX_API_PAGES) {
                var response = await withTimeout(
                    ZOHO.CRM.API.searchRecord(
                        {
                            Entity: REGISTRATION_MODULE,
                            Type: "criteria",
                            Query: criteria
                        },
                        String(page),
                        String(API_PAGE_SIZE)
                    ),
                    REQUEST_TIMEOUT_MS,
                    "Zoho took too long while loading existing registrations."
                );

                var pageRecords = extractRecords(response);
                registrations = registrations.concat(pageRecords);

                if (!responseHasMore(response, pageRecords)) {
                    break;
                }
                page += 1;
            }
        } catch (searchError) {
            registrations = [];
            page = 1;

            while (page <= MAX_API_PAGES) {
                var fallbackResponse = await withTimeout(
                    ZOHO.CRM.API.getAllRecords({
                        Entity: REGISTRATION_MODULE,
                        page: String(page),
                        per_page: String(API_PAGE_SIZE)
                    }),
                    REQUEST_TIMEOUT_MS,
                    "Zoho took too long while loading existing registrations."
                );

                var fallbackRecords = extractRecords(fallbackResponse);
                fallbackRecords.forEach(function (registration) {
                    var eventLookup = registration.Event;
                    if (
                        eventLookup &&
                        String(eventLookup.id || "") === String(state.eventId)
                    ) {
                        registrations.push(registration);
                    }
                });

                if (!responseHasMore(fallbackResponse, fallbackRecords)) {
                    break;
                }
                page += 1;
            }
        }

        state.registrationIds.clear();

        registrations.forEach(function (registration) {
            var registrationId = String(registration.id || "");

            if (registration.Patient && registration.Patient.id) {
                state.registrationIds.set(
                    selectionKey("patients", registration.Patient.id),
                    registrationId
                );
            }

            if (registration.Volunteer && registration.Volunteer.id) {
                state.registrationIds.set(
                    selectionKey("volunteers", registration.Volunteer.id),
                    registrationId
                );
            }

            if (
                registration.Family &&
                registration.Family.id &&
                !registration.Patient &&
                !registration.Volunteer
            ) {
                state.registrationIds.set(
                    selectionKey("families", registration.Family.id),
                    registrationId
                );
            }
        });
    }

    async function fetchAllModuleRecords(tabName) {
        var config = MODULES[tabName];
        var all = [];
        var page = 1;

        while (page <= MAX_API_PAGES) {
            var response = await withTimeout(
                ZOHO.CRM.API.getAllRecords({
                    Entity: config.entity,
                    page: String(page),
                    per_page: String(API_PAGE_SIZE)
                }),
                REQUEST_TIMEOUT_MS,
                "Zoho took too long while loading " + tabLabel(tabName).toLowerCase() + "."
            );

            var pageRecords = extractRecords(response);
            all = all.concat(pageRecords);

            if (!responseHasMore(response, pageRecords)) {
                break;
            }
            page += 1;
        }

        return all.map(function (record) {
            return normalizeRecord(tabName, record);
        });
    }

    function normalizeRecord(tabName, record) {
        var normalized = {
            id: String(record.id || ""),
            Name: String(record.Name || ""),
            moduleStatus: String(record[MODULES[tabName].statusField] || "")
        };

        var key = selectionKey(tabName, normalized.id);
        normalized.registrationId = String(state.registrationIds.get(key) || "");
        normalized.alreadyRegistered = normalized.registrationId !== "";

        if (tabName === "families") {
            normalized.Email = String(record.Email || "");
            normalized.Primary_Phone = String(record.Primary_Phone || "");
        } else if (tabName === "patients") {
            normalized.Date_of_Birth = record.Date_of_Birth || "";
            normalized.Age =
                record.Age === null || record.Age === undefined ? "" : record.Age;
            normalized.familyName =
                record.Family && record.Family.name ? String(record.Family.name) : "";
            normalized.familyId =
                record.Family && record.Family.id ? String(record.Family.id) : "";
        }

        if (normalized.alreadyRegistered) {
            state.selected.delete(key);
        }

        return normalized;
    }

    async function ensureActiveTabLoaded() {
        if (state.allRecords[state.activeTab] !== null) {
            return;
        }
        state.allRecords[state.activeTab] = await fetchAllModuleRecords(state.activeTab);
    }

    async function loadPage(preserveNotice) {
        if (!state.eventId || state.saving || state.removing) {
            return;
        }

        var requestNumber = state.requestNumber + 1;
        state.requestNumber = requestNumber;
        state.loading = true;
        state.records = [];
        state.moreRecords = false;

        if (preserveNotice !== true) {
            clearNotice();
        }

        render();

        try {
            await loadEventContext();
            await ensureActiveTabLoaded();

            if (requestNumber !== state.requestNumber) {
                return;
            }

            state.loading = false;
            applyLocalFilters();
        } catch (error) {
            if (requestNumber !== state.requestNumber) {
                return;
            }

            console.error("Event Registration sandbox load error:", error);
            state.loading = false;
            state.records = [];
            state.totalFiltered = 0;
            state.moreRecords = false;
            render(errorMessage(error));
        }
    }

    function selectedStatusOption(tabName) {
        var selected = state.statusFilters[tabName];
        if (!selected) {
            return null;
        }

        var options = MODULES[tabName].statuses;
        for (var index = 0; index < options.length; index += 1) {
            if (options[index].label === selected) {
                return options[index];
            }
        }
        return null;
    }

    function matchesSelectedStatus(record) {
        var option = selectedStatusOption(state.activeTab);
        if (!option) {
            return true;
        }

        var current = String(record.moduleStatus || "").trim().toLowerCase();
        return option.values.some(function (value) {
            return String(value).trim().toLowerCase() === current;
        });
    }

    function applyLocalFilters() {
        var source = state.allRecords[state.activeTab] || [];
        var searchLower = String(state.search || "").trim().toLowerCase();

        var filtered = source.filter(function (record) {
            if (!matchesSelectedStatus(record)) {
                return false;
            }

            if (!searchLower) {
                return true;
            }

            return String(record.Name || "").toLowerCase().indexOf(searchLower) !== -1;
        });

        state.totalFiltered = filtered.length;

        var maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        if (state.page > maxPage) {
            state.page = maxPage;
        }

        var start = (state.page - 1) * PAGE_SIZE;
        state.records = filtered.slice(start, start + PAGE_SIZE);
        state.moreRecords = start + PAGE_SIZE < filtered.length;
        render();
    }

    function errorMessage(error) {
        if (error && error.message) {
            return String(error.message);
        }
        if (typeof error === "string") {
            return error;
        }
        return "Unable to load records.";
    }

    function changeTab(tabName) {
        if (
            state.saving ||
            state.removing ||
            tabName === state.activeTab ||
            ["families", "patients", "volunteers"].indexOf(tabName) === -1
        ) {
            return;
        }

        state.activeTab = tabName;
        state.page = 1;
        state.search = "";
        state.records = [];
        state.totalFiltered = 0;
        state.moreRecords = false;
        elements.searchInput.value = "";
        populateStatusFilter();

        if (state.allRecords[tabName] === null) {
            loadPage();
        } else {
            applyLocalFilters();
        }
    }

    function populateStatusFilter() {
        if (!elements.statusFilter) {
            return;
        }

        var config = MODULES[state.activeTab];
        elements.statusFilter.textContent = "";

        var allOption = document.createElement("option");
        allOption.value = "";
        allOption.textContent = "All " + config.statusLabel + "es";
        elements.statusFilter.appendChild(allOption);

        config.statuses.forEach(function (status) {
            var option = document.createElement("option");
            option.value = status.label;
            option.textContent = status.label;
            elements.statusFilter.appendChild(option);
        });

        elements.statusFilter.value = state.statusFilters[state.activeTab] || "";
    }

    function applySearch() {
        if (state.saving || state.removing || !state.eventId) {
            return;
        }

        state.search = String(elements.searchInput.value || "").trim();
        state.page = 1;
        applyLocalFilters();
    }

    function clearSearch() {
        if (state.saving || state.removing || !state.eventId) {
            return;
        }

        elements.searchInput.value = "";

        if (state.search === "" && state.page === 1) {
            elements.searchInput.focus();
            return;
        }

        state.search = "";
        state.page = 1;
        applyLocalFilters();
    }

    function previousPage() {
        if (state.loading || state.saving || state.removing || state.page <= 1) {
            return;
        }
        state.page -= 1;
        applyLocalFilters();
    }

    function nextPage() {
        if (state.loading || state.saving || state.removing || !state.moreRecords) {
            return;
        }
        state.page += 1;
        applyLocalFilters();
    }

    function selectionKey(kind, recordId) {
        return kind + ":" + String(recordId);
    }

    function toggleSelection(record, checked) {
        var key = selectionKey(state.activeTab, record.id);

        if (record.alreadyRegistered) {
            state.selected.delete(key);
        } else if (checked) {
            state.selected.set(key, {
                kind: state.activeTab,
                record: record
            });
        } else {
            state.selected.delete(key);
        }

        updateControls();
    }

    function selectCurrentPage() {
        if (state.loading || state.saving || state.removing) {
            return;
        }

        state.records.forEach(function (record) {
            if (!record.alreadyRegistered) {
                var key = selectionKey(state.activeTab, record.id);
                state.selected.set(key, {
                    kind: state.activeTab,
                    record: record
                });
            }
        });

        renderTable();
        updateControls();
    }

    function clearSelection() {
        if (state.saving || state.removing) {
            return;
        }
        state.selected.clear();
        renderTable();
        updateControls();
    }

    function createCell(row, value, className) {
        var cell = document.createElement("td");
        if (className) {
            cell.className = className;
        }
        cell.textContent = value === null || value === undefined ? "" : String(value);
        if (className === "name-column") {
            cell.title = cell.textContent;
        }
        row.appendChild(cell);
        return cell;
    }

    function appendHeader(labels) {
        var row = document.createElement("tr");

        labels.forEach(function (label, index) {
            var cell = document.createElement("th");
            cell.scope = "col";
            cell.textContent = label;

            if (index === 0) {
                cell.className = "checkbox-column";
            } else if (label === "Action") {
                cell.className = "action-column";
            }

            if (
                label === "Patient Name" ||
                label === "Volunteer Name" ||
                label === "Family Name"
            ) {
                cell.classList.add("name-column");
            } else if (label === "DOB") {
                cell.classList.add("dob-column");
            } else if (label === "Age") {
                cell.classList.add("age-column");
            } else if (label === "Family") {
                cell.classList.add("family-column");
            } else if (
                label === "Family Status" ||
                label === "Status" ||
                label === "Volunteer Status"
            ) {
                cell.classList.add("module-status-column");
            } else if (label === "Registration") {
                cell.classList.add("registration-column");
            }

            row.appendChild(cell);
        });

        elements.tableHead.appendChild(row);
    }

    function appendRegistrationCell(row, alreadyRegistered) {
        var cell = document.createElement("td");
        cell.className = "registration-column";

        var badge = document.createElement("span");
        badge.className = alreadyRegistered
            ? "badge badge-registered"
            : "badge badge-available";
        badge.textContent = alreadyRegistered ? "Already Registered" : "Available";

        cell.appendChild(badge);
        row.appendChild(cell);
    }

    function appendActionCell(row, record) {
        var cell = document.createElement("td");
        cell.className = "action-column";

        if (record.alreadyRegistered && record.registrationId) {
            var removeButton = document.createElement("button");
            var isRemovingThisRecord =
                state.removing &&
                state.removingRegistrationId === record.registrationId;

            removeButton.type = "button";
            removeButton.className = "button button-danger button-small";
            removeButton.textContent = isRemovingThisRecord ? "Removing…" : "Remove";
            removeButton.disabled = state.loading || state.saving || state.removing;
            removeButton.setAttribute(
                "aria-label",
                "Remove " + (record.Name || "record") + " from this event"
            );
            removeButton.addEventListener("click", function () {
                removeRegistration(record);
            });
            cell.appendChild(removeButton);
        }

        row.appendChild(cell);
    }

    function appendRecordRow(record) {
        var row = document.createElement("tr");
        var key = selectionKey(state.activeTab, record.id);

        if (record.alreadyRegistered) {
            row.className = "registered-row";
        }

        var checkboxCell = document.createElement("td");
        checkboxCell.className = "checkbox-column";

        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = state.selected.has(key);
        checkbox.disabled =
            record.alreadyRegistered ||
            state.loading ||
            state.saving ||
            state.removing;
        checkbox.setAttribute(
            "aria-label",
            "Select " + (record.Name || "record")
        );
        checkbox.addEventListener("change", function () {
            toggleSelection(record, checkbox.checked);
        });

        checkboxCell.appendChild(checkbox);
        row.appendChild(checkboxCell);

        if (state.activeTab === "families") {
            createCell(row, record.Name, "name-column");
            createCell(row, record.Email || "", "email-column");
            createCell(row, record.Primary_Phone || "", "phone-column");
            createCell(row, record.moduleStatus || "—", "module-status-column");
        } else if (state.activeTab === "patients") {
            createCell(row, record.Name, "name-column");
            createCell(row, record.Date_of_Birth || "", "dob-column");
            createCell(
                row,
                record.Age === null || record.Age === undefined ? "" : record.Age,
                "age-column"
            );
            createCell(row, record.familyName || "", "family-column");
            createCell(row, record.moduleStatus || "—", "module-status-column");
        } else {
            createCell(row, record.Name, "name-column");
            createCell(row, record.moduleStatus || "—", "module-status-column");
        }

        appendRegistrationCell(row, record.alreadyRegistered);
        appendActionCell(row, record);
        elements.tableBody.appendChild(row);
    }

    function renderTable() {
        elements.tableHead.textContent = "";
        elements.tableBody.textContent = "";

        // Explicit pixel column widths prevent the browser from squeezing cell
        // contents together inside Zoho's narrow popup iframe.
        var widths = {
            families: [44, 190, 240, 145, 170, 145, 90],
            patients: [44, 190, 100, 55, 180, 170, 145, 90],
            volunteers: [44, 220, 180, 145, 90]
        }[state.activeTab];
        var table = elements.tableBody.closest("table");
        var oldColgroup = table.querySelector("colgroup");
        if (oldColgroup) {
            oldColgroup.remove();
        }
        var colgroup = document.createElement("colgroup");
        widths.forEach(function (width) {
            var col = document.createElement("col");
            col.style.width = width + "px";
            colgroup.appendChild(col);
        });
        table.insertBefore(colgroup, table.firstChild);
        var totalWidth = widths.reduce(function (total, width) {
            return total + width;
        }, 0);
        table.style.width = totalWidth + "px";
        table.style.minWidth = totalWidth + "px";
        table.style.tableLayout = "fixed";

        if (state.activeTab === "families") {
            appendHeader([
                "Add",
                "Family Name",
                "Email",
                "Primary Phone",
                "Family Status",
                "Registration",
                "Action"
            ]);
        } else if (state.activeTab === "patients") {
            appendHeader([
                "Add",
                "Patient Name",
                "DOB",
                "Age",
                "Family",
                "Status",
                "Registration",
                "Action"
            ]);
        } else {
            appendHeader([
                "Add",
                "Volunteer Name",
                "Volunteer Status",
                "Registration",
                "Action"
            ]);
        }

        state.records.forEach(appendRecordRow);
    }

    function render(loadError) {
        elements.app.setAttribute(
            "aria-busy",
            state.loading || state.saving || state.removing ? "true" : "false"
        );

        elements.eventName.textContent = state.eventId
            ? state.eventName
            : "Connecting to Zoho CRM…";

        elements.tabButtons.forEach(function (button) {
            var isActive = button.getAttribute("data-tab") === state.activeTab;
            button.classList.toggle("active", isActive);
            button.setAttribute("aria-selected", isActive ? "true" : "false");
        });

        var labels = {
            families: "Search families by name…",
            patients: "Search patients / siblings by name…",
            volunteers: "Search volunteers by name…"
        };

        elements.searchInput.placeholder = labels[state.activeTab];
        elements.pageLabel.textContent = "Page " + state.page;

        elements.loadingState.hidden = !state.loading;
        elements.errorState.hidden = !loadError;
        elements.emptyState.hidden =
            state.loading || !!loadError || state.records.length > 0;
        elements.tableContainer.hidden =
            state.loading || !!loadError || state.records.length === 0;

        if (state.loading) {
            elements.loadingText.textContent =
                "Loading " + tabLabel(state.activeTab).toLowerCase() + "…";
        }

        if (loadError) {
            elements.errorMessage.textContent = loadError;
        }

        if (!state.loading && !loadError && state.records.length === 0) {
            var hasFilter =
                !!state.search || !!state.statusFilters[state.activeTab];
            elements.emptyMessage.textContent = hasFilter
                ? "No records match the current search and status filter."
                : "No records found.";
        }

        if (!state.loading && !loadError && state.records.length > 0) {
            renderTable();
        }

        updateControls();
    }

    function tabLabel(tabName) {
        if (tabName === "families") {
            return "Families";
        }
        if (tabName === "volunteers") {
            return "Volunteers";
        }
        return "Patients / Siblings";
    }

    function updateControls() {
        var busy = state.loading || state.saving || state.removing;
        var selectedCount = state.selected.size;
        var availableCount = state.records.filter(function (record) {
            return !record.alreadyRegistered;
        }).length;

        elements.resultSummary.textContent = state.loading
            ? "Loading page " + state.page + "…"
            : state.totalFiltered +
              " matching record(s) • " +
              state.records.length +
              " shown on page " +
              state.page;

        elements.selectionSummary.textContent = selectedCount + " selected";
        elements.selectPageButton.disabled = busy || availableCount === 0;
        elements.clearSelectionButton.disabled =
            state.saving || state.removing || selectedCount === 0;
        elements.searchInput.disabled =
            state.saving || state.removing || !state.eventId;
        elements.statusFilter.disabled =
            state.saving || state.removing || state.loading || !state.eventId;
        elements.previousButton.disabled = busy || state.page <= 1;
        elements.nextButton.disabled = busy || !state.moreRecords;
        elements.saveButton.disabled =
            busy || selectedCount === 0 || !state.eventId;
        elements.doneButton.disabled = state.saving || state.removing;
        elements.saveButton.textContent = state.saving
            ? "Adding Registrations…"
            : "Add Selected to Event";

        elements.tabButtons.forEach(function (button) {
            button.disabled = state.saving || state.removing || !state.eventId;
        });
    }

    function buildRegistration(selectedItem) {
        var source = selectedItem.record;
        var registration = {
            Name: source.Name + " - " + state.eventName,
            Event: { id: state.eventId }
        };

        if (selectedItem.kind === "families") {
            registration.Type = "Family";
            registration.Family = { id: String(source.id) };
        } else if (selectedItem.kind === "patients") {
            registration.Type = "Sibling/ Patient";
            registration.Patient = { id: String(source.id) };
            if (source.familyId) {
                registration.Family = { id: String(source.familyId) };
            }
        } else if (selectedItem.kind === "volunteers") {
            registration.Type = "Volunteer";
            registration.Volunteer = { id: String(source.id) };
        }

        return registration;
    }

    function responseResults(response) {
        if (Array.isArray(response)) {
            return response;
        }
        if (response && Array.isArray(response.data)) {
            return response.data;
        }
        if (response && response.data && Array.isArray(response.data.data)) {
            return response.data.data;
        }
        if (response && (response.status || response.code)) {
            return [response];
        }
        return [];
    }

    function isSuccessfulResult(result) {
        return (
            !!result &&
            (String(result.status || "").toLowerCase() === "success" ||
                String(result.code || "").toUpperCase() === "SUCCESS")
        );
    }

    function markRegistrationState(kind, recordId, registrationId) {
        var key = selectionKey(kind, recordId);
        var registered = !!registrationId;

        if (registered) {
            state.registrationIds.set(key, String(registrationId));
        } else {
            state.registrationIds.delete(key);
        }

        var records = state.allRecords[kind] || [];
        records.forEach(function (record) {
            if (String(record.id) === String(recordId)) {
                record.registrationId = registered ? String(registrationId) : "";
                record.alreadyRegistered = registered;
            }
        });
    }

    async function removeRegistration(record) {
        if (
            state.loading ||
            state.saving ||
            state.removing ||
            !record.alreadyRegistered ||
            !record.registrationId
        ) {
            return;
        }

        var confirmed = window.confirm(
            "Remove \"" +
                record.Name +
                "\" from \"" +
                state.eventName +
                "\"?\n\nThis deletes only the Event Registration record."
        );

        if (!confirmed) {
            return;
        }

        state.removing = true;
        state.removingRegistrationId = record.registrationId;
        clearNotice();
        renderTable();
        updateControls();

        try {
            var response = await withTimeout(
                ZOHO.CRM.API.deleteRecord({
                    Entity: REGISTRATION_MODULE,
                    RecordID: record.registrationId
                }),
                REQUEST_TIMEOUT_MS,
                "Zoho took longer than 20 seconds while removing the registration."
            );

            var results = responseResults(response);

            if (!isSuccessfulResult(results[0])) {
                var resultMessage =
                    results[0] && (results[0].message || results[0].code);
                throw new Error(
                    resultMessage || "Zoho did not delete the registration."
                );
            }

            markRegistrationState(state.activeTab, record.id, "");
            state.selected.delete(selectionKey(state.activeTab, record.id));
            showNotice(record.Name + " was removed from the event.", "success");
        } catch (error) {
            console.error("Event Registration remove error:", error);
            showNotice(
                "Unable to remove registration: " + errorMessage(error),
                "error"
            );
        }

        state.removing = false;
        state.removingRegistrationId = "";
        applyLocalFilters();
    }

    async function saveRegistrations() {
        if (
            state.saving ||
            state.removing ||
            state.loading ||
            state.selected.size === 0
        ) {
            return;
        }

        var selectedEntries = Array.from(state.selected.entries());
        var successfulKeys = [];
        var failures = [];

        state.saving = true;
        clearNotice();
        updateControls();

        try {
            for (
                var start = 0;
                start < selectedEntries.length;
                start += SAVE_BATCH_SIZE
            ) {
                var entryBatch = selectedEntries.slice(
                    start,
                    start + SAVE_BATCH_SIZE
                );
                var recordBatch = entryBatch.map(function (entry) {
                    return buildRegistration(entry[1]);
                });

                var response = await withTimeout(
                    ZOHO.CRM.API.insertRecord({
                        Entity: REGISTRATION_MODULE,
                        APIData: recordBatch,
                        Trigger: ["workflow"]
                    }),
                    REQUEST_TIMEOUT_MS,
                    "Zoho took longer than 20 seconds while saving."
                );

                var results = responseResults(response);

                entryBatch.forEach(function (entry, index) {
                    var result = results[index];

                    if (isSuccessfulResult(result)) {
                        successfulKeys.push(entry[0]);

                        var registrationId =
                            result &&
                            result.details &&
                            result.details.id
                                ? String(result.details.id)
                                : "";

                        markRegistrationState(
                            entry[1].kind,
                            entry[1].record.id,
                            registrationId
                        );
                    } else {
                        failures.push(
                            result || { message: "No result returned" }
                        );
                    }
                });
            }

            successfulKeys.forEach(function (key) {
                state.selected.delete(key);
            });

            if (failures.length > 0) {
                console.error(
                    "Event Registration sandbox save failures:",
                    failures
                );
                showNotice(
                    successfulKeys.length +
                        " created; " +
                        failures.length +
                        " failed.",
                    "warning"
                );
            } else {
                showNotice(
                    successfulKeys.length + " registration(s) created.",
                    "success"
                );
            }
        } catch (error) {
            console.error("Event Registration sandbox save error:", error);
            showNotice(
                "Unable to create registrations: " + errorMessage(error),
                "error"
            );
        }

        state.saving = false;
        applyLocalFilters();
    }

    function showNotice(message, type) {
        elements.notice.textContent = message;
        elements.notice.className = "notice " + (type || "");
    }

    function clearNotice() {
        showNotice("", "");
    }

    function showFatalError(message) {
        state.started = false;
        state.loading = false;
        state.records = [];
        state.totalFiltered = 0;
        state.moreRecords = false;
        render(message);
    }

    function closeWidget() {
        if (state.saving || state.removing) {
            return;
        }

        if (
            window.ZOHO &&
            ZOHO.CRM &&
            ZOHO.CRM.UI &&
            ZOHO.CRM.UI.Popup &&
            typeof ZOHO.CRM.UI.Popup.closeReload === "function"
        ) {
            ZOHO.CRM.UI.Popup.closeReload();
        }
    }

    initialize();
}());
