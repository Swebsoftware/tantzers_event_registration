(function () {
    "use strict";

    var FUNCTION_NAME = "event_attendee_email";
    var REQUEST_TIMEOUT_MS = 30000;

    var state = {
        eventId: "",
        eventName: "Event",
        recipients: [],
        templates: [],
        recipientCount: 0,
        registrationCount: 0,
        missingEmailCount: 0,
        loading: false,
        sending: false,
        started: false,
        sent: false
    };

    var elements = {};

    function byId(id) {
        return document.getElementById(id);
    }

    function cacheElements() {
        elements.app = byId("app");
        elements.eventName = byId("event-name");
        elements.recipientSummary = byId("recipient-summary");
        elements.loadingState = byId("loading-state");
        elements.errorState = byId("error-state");
        elements.errorMessage = byId("error-message");
        elements.retryButton = byId("retry-button");
        elements.form = byId("email-form");
        elements.sendMode = byId("send-mode");
        elements.templateFields = byId("template-fields");
        elements.templateSelect = byId("template-select");
        elements.templateNote = byId("template-note");
        elements.customFields = byId("custom-fields");
        elements.subject = byId("subject-input");
        elements.message = byId("message-input");
        elements.recipientList = byId("recipient-list");
        elements.notice = byId("notice");
        elements.closeButton = byId("close-button");
        elements.sendButton = byId("send-button");
    }

    function addEventListeners() {
        elements.retryButton.addEventListener("click", loadPreview);
        elements.closeButton.addEventListener("click", closeWidget);
        elements.sendMode.addEventListener("change", updateComposerMode);
        elements.templateSelect.addEventListener("change", updateTemplateNote);
        elements.form.addEventListener("submit", function (event) {
            event.preventDefault();
            sendEmail();
        });
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
        if (responseBody && responseBody.details && responseBody.details.output !== undefined) {
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

        if (!output) {
            throw new Error("The CRM function returned an empty response.");
        }

        return output;
    }

    function callFunction(action, subject, message, templateId) {
        return withTimeout(
            ZOHO.CRM.FUNCTIONS.execute(FUNCTION_NAME, {
                arguments: JSON.stringify({
                    action: action,
                    event_id: state.eventId,
                    subject: subject || "",
                    message: message || "",
                    template_id: templateId || ""
                })
            }),
            REQUEST_TIMEOUT_MS,
            "The CRM function took longer than expected. Please try again."
        ).then(parseFunctionResponse);
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
            showFatalError("No Party Event ID was received. Open this widget from an Event record.");
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
        loadPreview();
    }

    async function loadPreview() {
        if (!state.eventId || state.loading || state.sending) {
            return;
        }

        state.loading = true;
        state.sent = false;
        setNotice("", "");
        render();

        try {
            var data = await callFunction("preview", "", "", "");
            if (data.success !== true) {
                throw new Error(data.message || "Unable to load registered attendees.");
            }

            state.eventName = String(data.event_name || "Event");
            state.recipients = Array.isArray(data.recipients) ? data.recipients : [];
            state.templates = Array.isArray(data.templates) ? data.templates : [];
            state.recipientCount = Number(data.recipient_count || 0);
            state.registrationCount = Number(data.registration_count || 0);
            state.missingEmailCount = Number(data.missing_email_count || 0);
            state.loading = false;

            if (!elements.subject.value.trim()) {
                elements.subject.value = "Event Update: " + state.eventName;
            }

            populateTemplateOptions();
            render();
            updateComposerMode();
        } catch (error) {
            console.error("Email attendee preview error:", error);
            state.loading = false;
            render(errorMessage(error));
        }
    }

    function populateTemplateOptions() {
        var previousValue = elements.templateSelect.value;
        elements.templateSelect.innerHTML = "";

        if (state.templates.length === 0) {
            var emptyOption = document.createElement("option");
            emptyOption.value = "";
            emptyOption.textContent = "No Event Registration templates available";
            elements.templateSelect.appendChild(emptyOption);
            return;
        }

        var promptOption = document.createElement("option");
        promptOption.value = "";
        promptOption.textContent = "Select a template…";
        elements.templateSelect.appendChild(promptOption);

        state.templates.forEach(function (template) {
            var option = document.createElement("option");
            option.value = String(template.id || "");
            option.textContent = String(template.name || "Template");
            option.setAttribute("data-subject", String(template.subject || ""));
            elements.templateSelect.appendChild(option);
        });

        if (previousValue) {
            elements.templateSelect.value = previousValue;
        }
        updateTemplateNote();
    }

    function updateComposerMode() {
        var useTemplate = elements.sendMode.value === "template";
        elements.templateFields.hidden = !useTemplate;
        elements.customFields.hidden = useTemplate;
        elements.subject.disabled = useTemplate || state.sending || state.sent;
        elements.message.disabled = useTemplate || state.sending || state.sent;
        elements.templateSelect.disabled = !useTemplate || state.sending || state.sent || state.templates.length === 0;

        if (useTemplate && state.templates.length === 0) {
            setNotice("No CRM email templates are available for Event Registrations.", "error");
        } else if (elements.notice.textContent === "No CRM email templates are available for Event Registrations.") {
            setNotice("", "");
        }

        updateTemplateNote();
    }

    function updateTemplateNote() {
        if (!elements.templateSelect || elements.templateSelect.selectedIndex < 0) {
            return;
        }
        var option = elements.templateSelect.options[elements.templateSelect.selectedIndex];
        var subject = option ? option.getAttribute("data-subject") : "";
        elements.templateNote.textContent = subject ? "Template subject: " + subject : "";
    }

    async function sendEmail() {
        if (state.sending || state.sent || state.recipientCount < 1) {
            return;
        }

        var useTemplate = elements.sendMode.value === "template";
        var subject = String(elements.subject.value || "").trim();
        var message = String(elements.message.value || "").trim();
        var templateId = useTemplate ? String(elements.templateSelect.value || "").trim() : "";

        if (useTemplate) {
            if (!templateId) {
                setNotice("Select a CRM email template.", "error");
                elements.templateSelect.focus();
                return;
            }
        } else {
            if (!subject) {
                setNotice("Enter an email subject.", "error");
                elements.subject.focus();
                return;
            }
            if (!message) {
                setNotice("Enter an email message.", "error");
                elements.message.focus();
                return;
            }
        }

        var modeText = useTemplate
            ? " using the selected CRM template"
            : "";
        var confirmed = window.confirm(
            "Send this email to " + state.recipientCount + " unique registered attendee email" +
            (state.recipientCount === 1 ? "" : "s") + modeText + "?"
        );
        if (!confirmed) {
            return;
        }

        state.sending = true;
        setNotice("Sending…", "");
        render();
        updateComposerMode();

        try {
            var data = await callFunction("send", subject, message, templateId);
            var sentCount = Number(data.sent_count || 0);
            var failedCount = Number(data.failed_count || 0);

            if (failedCount === 0 && data.success === true) {
                state.sent = true;
                setNotice(
                    "Sent successfully to " + sentCount + " unique attendee email" +
                    (sentCount === 1 ? "" : "s") + ".",
                    "success"
                );
            } else {
                var failed = Array.isArray(data.failed_recipients)
                    ? data.failed_recipients.join(", ")
                    : "";
                setNotice(
                    "Sent " + sentCount + ". Failed " + failedCount +
                    (failed ? ": " + failed : "."),
                    "error"
                );
            }
        } catch (error) {
            console.error("Email attendee send error:", error);
            setNotice(errorMessage(error), "error");
        } finally {
            state.sending = false;
            render();
            updateComposerMode();
        }
    }

    function render(error) {
        elements.app.setAttribute("aria-busy", state.loading || state.sending ? "true" : "false");
        elements.eventName.textContent = state.eventName || "Event";

        if (state.loading) {
            elements.loadingState.hidden = false;
            elements.errorState.hidden = true;
            elements.form.hidden = true;
            elements.recipientSummary.textContent = "Checking registered attendees…";
            return;
        }

        if (error) {
            elements.loadingState.hidden = true;
            elements.errorState.hidden = false;
            elements.form.hidden = true;
            elements.errorMessage.textContent = error;
            return;
        }

        elements.loadingState.hidden = true;
        elements.errorState.hidden = true;
        elements.form.hidden = false;

        var summary = state.recipientCount + " unique email" +
            (state.recipientCount === 1 ? "" : "s") +
            " from " + state.registrationCount + " registration" +
            (state.registrationCount === 1 ? "" : "s");
        if (state.missingEmailCount > 0) {
            summary += " · " + state.missingEmailCount + " missing email" +
                (state.missingEmailCount === 1 ? "" : "s");
        }
        elements.recipientSummary.textContent = summary;

        renderRecipientList();

        elements.sendMode.disabled = state.sending || state.sent;
        elements.subject.disabled = state.sending || state.sent;
        elements.message.disabled = state.sending || state.sent;
        elements.templateSelect.disabled = state.sending || state.sent;
        elements.sendButton.disabled = state.sending || state.sent || state.recipientCount < 1;
        elements.sendButton.textContent = state.sending ? "Sending…" : (state.sent ? "Email Sent" : "Send Email");
    }

    function renderRecipientList() {
        elements.recipientList.innerHTML = "";
        if (state.recipients.length === 0) {
            elements.recipientList.textContent = "No attendee emails found.";
            return;
        }

        state.recipients.forEach(function (recipient) {
            var row = document.createElement("div");
            row.textContent = String(recipient.email || "");
            elements.recipientList.appendChild(row);
        });
    }

    function setNotice(message, type) {
        elements.notice.textContent = message || "";
        elements.notice.className = "notice" + (type ? " " + type : "");
    }

    function showFatalError(message) {
        state.loading = false;
        render(message);
    }

    function errorMessage(error) {
        if (error && error.message) {
            return String(error.message);
        }
        if (typeof error === "string") {
            return error;
        }
        return "Unable to complete the request.";
    }

    function closeWidget() {
        if (window.ZOHO && ZOHO.CRM && ZOHO.CRM.UI && ZOHO.CRM.UI.Popup) {
            ZOHO.CRM.UI.Popup.close();
        } else {
            window.close();
        }
    }

    function initialize() {
        cacheElements();
        addEventListeners();
        render();

        if (!window.ZOHO || !ZOHO.embeddedApp) {
            showFatalError("The Zoho Widget SDK did not load. Open this widget from CRM.");
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
                    showFatalError("No Party Event ID was received. Open this widget from an Event record.");
                }
            }
        }, 8000);
    }

    document.addEventListener("DOMContentLoaded", initialize);
}());
