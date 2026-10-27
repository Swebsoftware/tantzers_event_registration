(function () {
    "use strict";

    var FUNCTION_NAME = "event_attendee_email";
    var REQUEST_TIMEOUT_MS = 30000;

    var state = {
        eventId: "",
        eventName: "Event",
        recipients: [],
        templates: [],
        allowedSenders: [],
        currentUserEmail: "",
        currentUserName: "",
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
        elements.senderSelect = byId("sender-select");
        elements.senderNote = byId("sender-note");
        elements.replyTo = byId("reply-to-input");
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
        elements.retryButton.addEventListener("click", function () {
            loadAll();
        });
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

            Promise.resolve(promise).then(function (value) {
                if (!finished) {
                    finished = true;
                    window.clearTimeout(timer);
                    resolve(value);
                }
            }, function (error) {
                if (!finished) {
                    finished = true;
                    window.clearTimeout(timer);
                    reject(error);
                }
            });
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

    function callFunction(action, subject, message, templateId, senderEmail, replyToEmail) {
        return withTimeout(
            ZOHO.CRM.FUNCTIONS.execute(FUNCTION_NAME, {
                arguments: JSON.stringify({
                    action: action,
                    event_id: state.eventId,
                    subject: subject || "",
                    message: message || "",
                    template_id: templateId || "",
                    sender_email: senderEmail || "",
                    reply_to_email: replyToEmail || ""
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

    function extractCurrentUser(data) {
        if (!data) {
            return null;
        }
        if (Array.isArray(data.users) && data.users.length) {
            return data.users[0];
        }
        if (data.data && Array.isArray(data.data.users) && data.data.users.length) {
            return data.data.users[0];
        }
        if (data.data && !Array.isArray(data.data)) {
            return data.data;
        }
        return data;
    }

    async function loadCurrentUser() {
        state.currentUserEmail = "";
        state.currentUserName = "";
        try {
            var result = await ZOHO.CRM.CONFIG.getCurrentUser();
            var user = extractCurrentUser(result);
            if (user) {
                state.currentUserEmail = String(user.email || user.Email || user.email_id || "").trim();
                state.currentUserName = String(user.full_name || user.name || user.Full_Name || "").trim();
            }
        } catch (error) {
            console.warn("Unable to load current CRM user:", error);
        }
    }

    function startFromPageData(pageData) {
        var candidate = pageData.EntityId || pageData.EntityID || pageData.RecordID || pageData.record_id || pageData.id || "";
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
        loadAll();
    }

    async function loadAll() {
        if (!state.eventId || state.loading || state.sending) {
            return;
        }

        state.loading = true;
        state.sent = false;
        setNotice("", "");
        render();

        try {
            await loadCurrentUser();
            var data = await callFunction("preview", "", "", "", "", "");
            if (data.success !== true) {
                throw new Error(data.message || "Unable to load registered attendees.");
            }

            state.eventName = String(data.event_name || "Event");
            state.recipients = Array.isArray(data.recipients) ? data.recipients : [];
            state.templates = Array.isArray(data.templates) ? data.templates : [];
            state.allowedSenders = Array.isArray(data.allowed_senders) ? data.allowed_senders : [];
            state.recipientCount = Number(data.recipient_count || 0);
            state.registrationCount = Number(data.registration_count || 0);
            state.missingEmailCount = Number(data.missing_email_count || 0);
            state.loading = false;

            if (!elements.subject.value.trim()) {
                elements.subject.value = "Event Update: " + state.eventName;
            }

            populateSenderOptions();
            populateTemplateOptions();
            render();
            updateComposerMode();
        } catch (error) {
            state.loading = false;
            render(errorMessage(error));
        }
    }

    function populateSenderOptions() {
        elements.senderSelect.innerHTML = "";

        state.allowedSenders.forEach(function (sender) {
            var option = document.createElement("option");
            option.value = String(sender.email || "");
            var label = String(sender.name || sender.email || "Sender");
            if (sender.email && label.toLowerCase() !== String(sender.email).toLowerCase()) {
                label += " <" + sender.email + ">";
            }
            option.textContent = label;
            option.setAttribute("data-type", String(sender.type || ""));
            elements.senderSelect.appendChild(option);
        });

        var currentLower = state.currentUserEmail.toLowerCase();
        var currentMatch = state.allowedSenders.find(function (sender) {
            return String(sender.email || "").toLowerCase() === currentLower && currentLower !== "";
        });

        var selected = currentMatch || state.allowedSenders.find(function (sender) {
            return String(sender.type || "").toLowerCase() === "org_email";
        }) || state.allowedSenders[0];

        if (selected && selected.email) {
            elements.senderSelect.value = String(selected.email);
        }

        elements.replyTo.value = state.currentUserEmail || "";

        if (state.currentUserEmail && currentMatch) {
            elements.senderNote.textContent = "Sender and Reply-To default to your CRM email: " + state.currentUserEmail;
        } else if (state.currentUserEmail && selected) {
            elements.senderNote.textContent = "Your CRM email (" + state.currentUserEmail + ") is not an allowed From address, so Sender defaults to " + selected.email + ". Reply-To still uses your CRM email.";
        } else if (selected) {
            elements.senderNote.textContent = "Sender defaults to " + selected.email + ".";
        } else {
            elements.senderNote.textContent = "No allowed sender address is available.";
        }
    }

    function populateTemplateOptions() {
        elements.templateSelect.innerHTML = "";

        var prompt = document.createElement("option");
        prompt.value = "";
        prompt.textContent = state.templates.length ? "Select a template…" : "No Event Registration templates available";
        elements.templateSelect.appendChild(prompt);

        state.templates.forEach(function (template) {
            var option = document.createElement("option");
            option.value = String(template.id || "");
            option.textContent = String(template.name || "Template");
            option.setAttribute("data-subject", String(template.subject || ""));
            elements.templateSelect.appendChild(option);
        });

        updateTemplateNote();
    }

    function updateComposerMode() {
        var useTemplate = elements.sendMode.value === "template";
        elements.templateFields.hidden = !useTemplate;
        elements.customFields.hidden = useTemplate;
        elements.subject.disabled = useTemplate || state.sending || state.sent;
        elements.message.disabled = useTemplate || state.sending || state.sent;
        elements.templateSelect.disabled = !useTemplate || state.sending || state.sent || state.templates.length === 0;
        elements.senderSelect.disabled = state.sending || state.sent || state.allowedSenders.length === 0;
        elements.replyTo.disabled = state.sending || state.sent;

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

    function showSendConfirmation(label, senderEmail, replyToEmail) {
        return new Promise(function (resolve) {
            var old = byId("send-confirm-overlay");
            if (old) {
                old.remove();
            }

            var overlay = document.createElement("div");
            overlay.id = "send-confirm-overlay";
            overlay.style.cssText = "position:fixed;inset:0;background:rgba(17,24,39,.38);display:flex;align-items:center;justify-content:center;padding:20px;z-index:99999;";

            var card = document.createElement("div");
            card.style.cssText = "width:min(460px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.2);padding:22px;";

            var title = document.createElement("h2");
            title.textContent = "Confirm email send";
            title.style.cssText = "margin:0 0 8px;font-size:18px;color:#111827;";

            var text = document.createElement("p");
            text.textContent = "Send to " + state.recipientCount + " unique registered attendee email" + (state.recipientCount === 1 ? "" : "s") + label + "?";
            text.style.cssText = "margin:0;color:#4b5563;font-size:14px;line-height:1.5;";

            var senderText = document.createElement("p");
            senderText.textContent = "From: " + senderEmail + (replyToEmail ? " · Reply-To: " + replyToEmail : "");
            senderText.style.cssText = "margin:10px 0 0;color:#6b7280;font-size:12px;line-height:1.5;";

            var actions = document.createElement("div");
            actions.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:20px;";

            var cancel = document.createElement("button");
            cancel.type = "button";
            cancel.textContent = "Cancel";
            cancel.style.cssText = "border:0;border-radius:8px;padding:10px 16px;background:#eef2f7;color:#374151;font-weight:650;cursor:pointer;";

            var send = document.createElement("button");
            send.type = "button";
            send.textContent = "Send Now";
            send.style.cssText = "border:0;border-radius:8px;padding:10px 16px;background:#2563eb;color:#fff;font-weight:650;cursor:pointer;";

            function finish(result) {
                overlay.remove();
                resolve(result);
            }

            cancel.addEventListener("click", function () { finish(false); });
            send.addEventListener("click", function () { finish(true); });
            overlay.addEventListener("click", function (event) {
                if (event.target === overlay) {
                    finish(false);
                }
            });

            actions.appendChild(cancel);
            actions.appendChild(send);
            card.appendChild(title);
            card.appendChild(text);
            card.appendChild(senderText);
            card.appendChild(actions);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
            send.focus();
        });
    }

    async function sendEmail() {
        if (state.sending || state.sent || state.recipientCount < 1) {
            return;
        }

        var senderEmail = String(elements.senderSelect.value || "").trim();
        var replyToEmail = String(elements.replyTo.value || "").trim();
        var useTemplate = elements.sendMode.value === "template";
        var subject = String(elements.subject.value || "").trim();
        var message = String(elements.message.value || "").trim();
        var templateId = useTemplate ? String(elements.templateSelect.value || "").trim() : "";
        var confirmationLabel = "";

        if (!senderEmail) {
            setNotice("Select a sender email address.", "error");
            elements.senderSelect.focus();
            return;
        }

        if (replyToEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyToEmail)) {
            setNotice("Enter a valid Reply-To email address.", "error");
            elements.replyTo.focus();
            return;
        }

        if (useTemplate) {
            if (!templateId) {
                setNotice("Select a CRM email template.", "error");
                elements.templateSelect.focus();
                return;
            }
            var selected = elements.templateSelect.options[elements.templateSelect.selectedIndex];
            confirmationLabel = selected ? " using “" + selected.textContent + "”" : " using the selected CRM template";
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

        var confirmed = await showSendConfirmation(confirmationLabel, senderEmail, replyToEmail);
        if (!confirmed) {
            return;
        }

        state.sending = true;
        setNotice("Sending…", "");
        render();
        updateComposerMode();

        try {
            var data = await callFunction("send", subject, message, templateId, senderEmail, replyToEmail);
            var sentCount = Number(data.sent_count || 0);
            var failedCount = Number(data.failed_count || 0);

            if (failedCount === 0 && data.success === true) {
                state.sent = true;
                setNotice("Sent successfully to " + sentCount + " unique attendee email" + (sentCount === 1 ? "" : "s") + ".", "success");
                window.setTimeout(closeWidget, 900);
            } else {
                var failed = Array.isArray(data.failed_recipients) ? data.failed_recipients.join("; ") : "";
                setNotice((data.message || "Email send failed.") + (failed ? " " + failed : ""), "error");
            }
        } catch (error) {
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

        var summary = state.recipientCount + " unique email" + (state.recipientCount === 1 ? "" : "s") + " from " + state.registrationCount + " registration" + (state.registrationCount === 1 ? "" : "s");
        if (state.missingEmailCount > 0) {
            summary += " · " + state.missingEmailCount + " missing email" + (state.missingEmailCount === 1 ? "" : "s");
        }
        elements.recipientSummary.textContent = summary;

        renderRecipientList();
        elements.sendMode.disabled = state.sending || state.sent;
        elements.sendButton.disabled = state.sending || state.sent || state.recipientCount < 1 || state.allowedSenders.length < 1;
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
