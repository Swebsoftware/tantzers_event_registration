(function () {
    "use strict";

    var OPTIONS_FUNCTION = "get_event_registration_options_1";
    var REGISTRATION_MODULE = "Event_Registrations";
    var REQUEST_TIMEOUT_MS = 20000;
    var SAVE_BATCH_SIZE = 100;

    var state = {
        eventId: "",
        eventName: "Event",
        activeTab: "patients",
        page: 1,
        search: "",
        records: [],
        moreRecords: false,
        loading: false,
        saving: false,
        removing: false,
        removingRegistrationId: "",
        started: false,
        requestNumber: 0,
        selected: new Map(),
        cache: new Map()
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
        elements.searchButton = byId("search-button");
        elements.clearSearchButton = byId("clear-search-button");
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

        elements.clearSearchButton.addEventListener("click", clearSearch);
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
        console.log("Event Registration Widget PageLoad:", pageData);

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
        state.page = 1;
        state.search = "";
        state.records = [];
        state.moreRecords = false;
        state.cache.clear();
        elements.searchInput.value = "";
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

    function parseFunctionResponse(response) {
        var responseBody = response;

        if (responseBody && responseBody.data !== undefined) {
            responseBody = responseBody.data;
        }

        var output = responseBody;

        if (
            responseBody &&
            responseBody.details &&
            responseBody.details.output !== undefined
        ) {
            output = responseBody.details.output;
        } else if (responseBody && responseBody.output !== undefined) {
            output = responseBody.output;
        }

        var parseCount = 0;
        while (typeof output === "string" && parseCount < 2) {
            var trimmed = output.trim();
            if (!trimmed) {
                break;
            }
            output = JSON.parse(trimmed);
            parseCount += 1;
        }

        if (!output || output.success !== true) {
            var message = "The CRM function did not return records.";

            if (output && output.message) {
                message = output.message;
            } else if (responseBody && responseBody.message) {
                message = responseBody.message;
            }

            throw new Error(message);
        }

        return output;
    }

    function callOptionsFunction() {
        var functionArguments = {
            module_type: state.activeTab,
            page_number: String(state.page),
            search_text: state.search,
            event_id: state.eventId
        };

        return withTimeout(
            ZOHO.CRM.FUNCTIONS.execute(OPTIONS_FUNCTION, {
                arguments: JSON.stringify(functionArguments)
            }),
            REQUEST_TIMEOUT_MS,
            "The CRM function took longer than 20 seconds. Please try again."
        ).then(parseFunctionResponse);
    }

    function cacheKey() {
        return [
            state.activeTab,
            String(state.page),
            state.search.toLowerCase()
        ].join("|");
    }

    function normalizeRecord(record) {
        var normalized = Object.assign({}, record);
        normalized.id = String(record.id || "");
        normalized.Name = String(record.Name || "");
        normalized.registrationId = String(record.registrationId || "");
        normalized.alreadyRegistered = record.alreadyRegistered === true;

        if (normalized.alreadyRegistered) {
            state.selected.delete(selectionKey(state.activeTab, normalized.id));
        }

        return normalized;
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

        var key = cacheKey();

        try {
            var functionData;

            if (state.cache.has(key)) {
                functionData = state.cache.get(key);
            } else {
                functionData = await callOptionsFunction();
                state.cache.set(key, functionData);
            }

            if (requestNumber !== state.requestNumber) {
                return;
            }

            state.eventName = String(functionData.event_name || "Event");
            state.records = (functionData.records || []).map(normalizeRecord);
            state.moreRecords = functionData.more_records === true;
            state.loading = false;
            render();
        } catch (error) {
            if (requestNumber !== state.requestNumber) {
                return;
            }

            console.error("Event Registration load error:", error);
            state.loading = false;
            state.records = [];
            state.moreRecords = false;
            render(errorMessage(error));
        }
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
        state.moreRecords = false;
        elements.searchInput.value = "";
        loadPage();
    }

    function applySearch() {
        if (state.saving || state.removing || !state.eventId) {
            return;
        }

        state.search = String(elements.searchInput.value || "").trim();
        state.page = 1;
        state.records = [];
        state.moreRecords = false;
        loadPage();
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
        state.records = [];
        state.moreRecords = false;
        loadPage();
    }

    function previousPage() {
        if (state.loading || state.saving || state.removing || state.page <= 1) {
            return;
        }
        state.page -= 1;
        loadPage();
    }

    function nextPage() {
        if (state.loading || state.saving || state.removing || !state.moreRecords) {
            return;
        }
        state.page += 1;
        loadPage();
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
                record: Object.assign({}, record)
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
                    record: Object.assign({}, record)
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
            row.appendChild(cell);
        });
        elements.tableHead.appendChild(row);
    }

    function appendStatusCell(row, alreadyRegistered) {
        var cell = document.createElement("td");
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
        checkbox.name = "registration_selection";
        checkbox.value = record.id;
        checkbox.checked = state.selected.has(key);
        checkbox.disabled = record.alreadyRegistered || state.saving;
        checkbox.setAttribute("aria-label", "Select " + (record.Name || "record"));
        checkbox.addEventListener("change", function () {
            toggleSelection(record, checkbox.checked);
        });
        checkboxCell.appendChild(checkbox);
        row.appendChild(checkboxCell);

        if (state.activeTab === "families") {
            createCell(row, record.Name);
            createCell(row, record.Email || "");
            createCell(row, record.Primary_Phone || "");
        } else if (state.activeTab === "patients") {
            createCell(row, record.Name);
            createCell(row, record.Date_of_Birth || "");
            createCell(row, record.Age === null || record.Age === undefined ? "" : record.Age);
            createCell(row, record.familyName || "");
        } else {
            createCell(row, record.Name);
        }

        appendStatusCell(row, record.alreadyRegistered);
        appendActionCell(row, record);
        elements.tableBody.appendChild(row);
    }

    function renderTable() {
        elements.tableHead.textContent = "";
        elements.tableBody.textContent = "";

        if (state.activeTab === "families") {
            appendHeader(["Add", "Family Name", "Email", "Primary Phone", "Status", "Action"]);
        } else if (state.activeTab === "patients") {
            appendHeader(["Add", "Patient Name", "Date of Birth", "Age", "Family", "Status", "Action"]);
        } else {
            appendHeader(["Add", "Volunteer Name", "Status", "Action"]);
        }

        state.records.forEach(appendRecordRow);
    }

    function render(loadError) {
        elements.app.setAttribute(
            "aria-busy",
            state.loading || state.saving || state.removing ? "true" : "false"
        );
        elements.eventName.textContent = state.eventId ? state.eventName : "Connecting to Zoho CRM…";

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
        elements.emptyState.hidden = state.loading || !!loadError || state.records.length > 0;
        elements.tableContainer.hidden = state.loading || !!loadError || state.records.length === 0;

        if (state.loading) {
            elements.loadingText.textContent = "Loading " + tabLabel(state.activeTab).toLowerCase() + "…";
        }

        if (loadError) {
            elements.errorMessage.textContent = loadError;
        }

        if (!state.loading && !loadError && state.records.length === 0) {
            elements.emptyMessage.textContent = state.search
                ? "No records found for “" + state.search + "”."
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
            : state.records.length + " record(s) on page " + state.page;

        elements.selectionSummary.textContent = selectedCount + " selected";
        elements.selectPageButton.disabled = busy || availableCount === 0;
        elements.clearSelectionButton.disabled =
            state.saving || state.removing || selectedCount === 0;
        elements.searchInput.disabled = state.saving || state.removing || !state.eventId;
        elements.searchButton.disabled = state.saving || state.removing || !state.eventId;
        elements.clearSearchButton.disabled =
            state.saving || state.removing || !state.eventId;
        elements.previousButton.disabled = busy || state.page <= 1;
        elements.nextButton.disabled = busy || !state.moreRecords;
        elements.saveButton.disabled = busy || selectedCount === 0 || !state.eventId;
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
        return !!result && (
            String(result.status || "").toLowerCase() === "success" ||
            String(result.code || "").toUpperCase() === "SUCCESS"
        );
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
            "Remove \"" + record.Name + "\" from \"" + state.eventName + "\"?\n\n" +
            "This deletes only the Event Registration record."
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
                throw new Error(resultMessage || "Zoho did not delete the registration.");
            }

            state.cache.clear();
            showNotice(record.Name + " was removed from the event.", "success");
        } catch (error) {
            console.error("Event Registration remove error:", error);
            showNotice("Unable to remove registration: " + errorMessage(error), "error");
        }

        state.removing = false;
        state.removingRegistrationId = "";
        updateControls();
        loadPage(true);
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
            for (var start = 0; start < selectedEntries.length; start += SAVE_BATCH_SIZE) {
                var entryBatch = selectedEntries.slice(start, start + SAVE_BATCH_SIZE);
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
                    if (isSuccessfulResult(results[index])) {
                        successfulKeys.push(entry[0]);
                    } else {
                        failures.push(results[index] || { message: "No result returned" });
                    }
                });
            }

            successfulKeys.forEach(function (key) {
                state.selected.delete(key);
            });

            state.cache.clear();

            if (failures.length > 0) {
                console.error("Event Registration save failures:", failures);
                showNotice(
                    successfulKeys.length + " created; " + failures.length + " failed.",
                    "warning"
                );
            } else {
                showNotice(successfulKeys.length + " registration(s) created.", "success");
            }
        } catch (error) {
            console.error("Event Registration save error:", error);
            showNotice("Unable to create registrations: " + errorMessage(error), "error");
        }

        state.saving = false;
        updateControls();
        loadPage(true);
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
