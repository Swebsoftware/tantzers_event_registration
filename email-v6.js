(function () {
    "use strict";

    var FUNCTION_NAME = "event_attendee_email";
    var REQUEST_TIMEOUT_MS = 30000;

    var state = {
        eventId: "",
        eventName: "Event",
        eventOwner: { name: "", email: "" },
        currentUser: { name: "", email: "" },
        recipients: [],
        templates: [],
        allowedSenders: [],
        recipientCount: 0,
        registrationCount: 0,
        missingEmailCount: 0,
        loading: false,
        sending: false,
        started: false,
        sent: false
    };

    var elements = {};

    function byId(id) { return document.getElementById(id); }

    function cacheElements() {
        elements.app = byId("app");
        elements.eventName = byId("event-name");
        elements.loadingState = byId("loading-state");
        elements.errorState = byId("error-state");
        elements.errorMessage = byId("error-message");
        elements.retryButton = byId("retry-button");
        elements.form = byId("email-form");
        elements.senderSelect = byId("sender-select");
        elements.replyToSelect = byId("reply-to-select");
        elements.addressNote = byId("address-note");
        elements.sendMode = byId("send-mode");
        elements.templateFields = byId("template-fields");
        elements.templateSelect = byId("template-select");
        elements.templateNote = byId("template-note");
        elements.customFields = byId("custom-fields");
        elements.subject = byId("subject-input");
        elements.message = byId("message-input");
        elements.recipientSummary = byId("recipient-summary");
        elements.recipientList = byId("recipient-list");
        elements.notice = byId("notice");
        elements.closeButton = byId("close-button");
        elements.sendButton = byId("send-button");
    }

    function addEventListeners() {
        elements.retryButton.addEventListener("click", loadAll);
        elements.closeButton.addEventListener("click", closeWidget);
        elements.sendMode.addEventListener("change", function () {
            updateComposerMode();
            updateAddressNote();
        });
        elements.senderSelect.addEventListener("change", updateAddressNote);
        elements.replyToSelect.addEventListener("change", updateAddressNote);
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
        var body = response;
        if (body && body.data !== undefined) body = body.data;
        var output = body;
        if (body && body.details && body.details.output !== undefined) output = body.details.output;
        else if (body && body.output !== undefined) output = body.output;

        var count = 0;
        while (typeof output === "string" && count < 2) {
            var trimmed = output.trim();
            if (!trimmed) break;
            output = JSON.parse(trimmed);
            count += 1;
        }
        if (!output) throw new Error("The CRM function returned an empty response.");
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

    function extractFirstRecord(result) {
        if (!result) return null;
        if (Array.isArray(result.data) && result.data.length) return result.data[0];
        if (result.data && Array.isArray(result.data.data) && result.data.data.length) return result.data.data[0];
        return null;
    }

    function extractCurrentUser(result) {
        if (!result) return null;
        if (Array.isArray(result.users) && result.users.length) return result.users[0];
        if (result.data && Array.isArray(result.data.users) && result.data.users.length) return result.data.users[0];
        if (result.data && !Array.isArray(result.data)) return result.data;
        return result;
    }

    async function loadCurrentUser() {
        try {
            var result = await ZOHO.CRM.CONFIG.getCurrentUser();
            var user = extractCurrentUser(result);
            if (user) {
                state.currentUser.name = String(user.full_name || user.name || user.Full_Name || "").trim();
                state.currentUser.email = String(user.email || user.Email || user.email_id || "").trim();
            }
        } catch (error) {
            console.warn("Unable to load current CRM user", error);
        }
    }

    async function loadEventOwner() {
        try {
            var result = await ZOHO.CRM.API.getRecord({ Entity: "Party_Events", RecordID: state.eventId });
            var record = extractFirstRecord(result);
            if (!record) return;
            var owner = record.Owner || record.owner || null;
            if (owner) {
                state.eventOwner.name = String(owner.name || owner.full_name || "").trim();
                state.eventOwner.email = String(owner.email || owner.Email || "").trim();
            }
        } catch (error) {
            console.warn("Unable to load event owner", error);
        }
    }

    function startFromPageData(pageData) {
        var candidate = pageData.EntityId || pageData.EntityID || pageData.RecordID || pageData.record_id || pageData.id || "";
        if (Array.isArray(candidate)) candidate = candidate.length ? candidate[0] : "";
        candidate = String(candidate || "").trim() || getQueryEventId();
        if (!candidate) {
            showFatalError("No Party Event ID was received. Open this widget from an Event record.");
            return;
        }
        startWithEventId(candidate);
    }

    function startWithEventId(eventId) {
        if (state.started && state.eventId === eventId) return;
        state.started = true;
        state.eventId = eventId;
        loadAll();
    }

    async function loadAll() {
        if (!state.eventId || state.loading || state.sending) return;
        state.loading = true;
        state.sent = false;
        setNotice("", "");
        render();

        try {
            await Promise.all([loadCurrentUser(), loadEventOwner()]);
            var data = await callFunction("preview", "", "", "", "", "");
            if (data.success !== true) throw new Error(data.message || "Unable to load registered attendees.");

            state.eventName = String(data.event_name || "Event");
            state.recipients = Array.isArray(data.recipients) ? data.recipients : [];
            state.templates = Array.isArray(data.templates) ? data.templates : [];
            state.allowedSenders = Array.isArray(data.allowed_senders) ? data.allowed_senders : [];
            state.recipientCount = Number(data.recipient_count || 0);
            state.registrationCount = Number(data.registration_count || 0);
            state.missingEmailCount = Number(data.missing_email_count || 0);
            state.loading = false;

            if (!elements.subject.value.trim()) elements.subject.value = "Event Update: " + state.eventName;
            populateAddressOptions();
            populateTemplateOptions();
            render();
            updateComposerMode();
            updateAddressNote();
        } catch (error) {
            state.loading = false;
            render(errorMessage(error));
        }
    }

    function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }

    function isAllowedSender(email) {
        var key = normalizeEmail(email);
        return state.allowedSenders.some(function (sender) {
            return normalizeEmail(sender.email) === key;
        });
    }

    function optionLabel(name, email) {
        name = String(name || "").trim();
        email = String(email || "").trim();
        if (name && email && normalizeEmail(name) !== normalizeEmail(email)) return name + " <" + email + ">";
        return email || name;
    }

    function addChoice(group, email, name, source, labelOverride) {
        if (!email) return;
        var option = document.createElement("option");
        option.value = email;
        option.textContent = labelOverride || optionLabel(name, email);
        option.setAttribute("data-source", source);
        group.appendChild(option);
    }

    function buildAddressSelect(select, defaultSource) {
        select.innerHTML = "";
        var used = {};

        if (state.currentUser.email) {
            var myGroup = document.createElement("optgroup");
            myGroup.label = "My Email";
            addChoice(myGroup, state.currentUser.email, state.currentUser.name, "current_user", optionLabel(state.currentUser.name, state.currentUser.email));
            used[normalizeEmail(state.currentUser.email)] = true;
            select.appendChild(myGroup);
        }

        var otherGroup = document.createElement("optgroup");
        otherGroup.label = "Other Emails";
        if (state.eventOwner.email) {
            addChoice(otherGroup, state.eventOwner.email, state.eventOwner.name, "record_owner", "Record Owner's Email — " + optionLabel(state.eventOwner.name, state.eventOwner.email));
            used[normalizeEmail(state.eventOwner.email)] = true;
        }

        state.allowedSenders.forEach(function (sender) {
            var type = String(sender.type || "").toLowerCase();
            var key = normalizeEmail(sender.email);
            if (!sender.email || type === "org_email" || used[key]) return;
            addChoice(otherGroup, sender.email, sender.name, type || "allowed", optionLabel(sender.name, sender.email));
            used[key] = true;
        });
        if (otherGroup.children.length) select.appendChild(otherGroup);

        var orgGroup = document.createElement("optgroup");
        orgGroup.label = "Organization Emails";
        state.allowedSenders.forEach(function (sender) {
            var type = String(sender.type || "").toLowerCase();
            var key = normalizeEmail(sender.email);
            if (!sender.email || type !== "org_email" || used[key]) return;
            addChoice(orgGroup, sender.email, sender.name, "org_email", optionLabel(sender.name, sender.email));
            used[key] = true;
        });
        if (orgGroup.children.length) select.appendChild(orgGroup);

        var preferred = "";
        if (defaultSource === "current_user" && state.currentUser.email) preferred = state.currentUser.email;
        else if (defaultSource === "record_owner" && state.eventOwner.email) preferred = state.eventOwner.email;
        if (!preferred && state.allowedSenders.length) preferred = String(state.allowedSenders[0].email || "");
        if (preferred) select.value = preferred;
    }

    function populateAddressOptions() {
        buildAddressSelect(elements.senderSelect, "current_user");
        buildAddressSelect(elements.replyToSelect, "current_user");
    }

    function selectedSource(select) {
        if (!select || select.selectedIndex < 0) return "";
        return select.options[select.selectedIndex].getAttribute("data-source") || "";
    }

    function updateAddressNote() {
        var senderEmail = String(elements.senderSelect.value || "").trim();
        var senderSource = selectedSource(elements.senderSelect);
        var useTemplate = elements.sendMode.value === "template";
        var message = "";

        if (senderEmail && !isAllowedSender(senderEmail) && (senderSource === "current_user" || senderSource === "record_owner")) {
            message = (senderSource === "record_owner" ? "Record Owner's Email" : "My Email") +
                " is a special Zoho Mass Email sender type. It is not in the individual Send Mail API's allowed-From list for this account.";
            if (useTemplate) message += " The native Mass Email screen supports this sender with templates.";
        }

        elements.addressNote.textContent = message;
        elements.addressNote.hidden = !message;
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
        elements.senderSelect.disabled = state.sending || state.sent;
        elements.replyToSelect.disabled = state.sending || state.sent;
        if (useTemplate && state.templates.length === 0) setNotice("No CRM email templates are available for Event Registrations.", "error");
        else if (elements.notice.textContent === "No CRM email templates are available for Event Registrations.") setNotice("", "");
        updateTemplateNote();
    }

    function updateTemplateNote() {
        if (!elements.templateSelect || elements.templateSelect.selectedIndex < 0) return;
        var option = elements.templateSelect.options[elements.templateSelect.selectedIndex];
        var subject = option ? option.getAttribute("data-subject") : "";
        elements.templateNote.textContent = subject ? "Template subject: " + subject : "";
    }

    function showSendConfirmation(label, senderEmail, replyToEmail) {
        return new Promise(function (resolve) {
            var old = byId("send-confirm-overlay");
            if (old) old.remove();
            var overlay = document.createElement("div");
            overlay.id = "send-confirm-overlay";
            overlay.style.cssText = "position:fixed;inset:0;background:rgba(17,24,39,.38);display:flex;align-items:center;justify-content:center;padding:20px;z-index:99999";
            var card = document.createElement("div");
            card.style.cssText = "width:min(460px,100%);background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.2);padding:22px";
            var title = document.createElement("h2");
            title.textContent = "Confirm email send";
            title.style.cssText = "margin:0 0 8px;font-size:18px;color:#111827";
            var text = document.createElement("p");
            text.textContent = "Send to " + state.recipientCount + " unique registered attendee email" + (state.recipientCount === 1 ? "" : "s") + label + "?";
            text.style.cssText = "margin:0;color:#4b5563;font-size:14px;line-height:1.5";
            var meta = document.createElement("p");
            meta.textContent = "From: " + senderEmail + (replyToEmail ? " · Reply-To: " + replyToEmail : "");
            meta.style.cssText = "margin:10px 0 0;color:#6b7280;font-size:12px;line-height:1.5";
            var actions = document.createElement("div");
            actions.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:20px";
            var cancel = document.createElement("button");
            cancel.type = "button";
            cancel.textContent = "Cancel";
            cancel.style.cssText = "border:0;border-radius:8px;padding:10px 16px;background:#eef2f7;color:#374151;font-weight:650;cursor:pointer";
            var send = document.createElement("button");
            send.type = "button";
            send.textContent = "Send Now";
            send.style.cssText = "border:0;border-radius:8px;padding:10px 16px;background:#2563eb;color:#fff;font-weight:650;cursor:pointer";
            function finish(value) { overlay.remove(); resolve(value); }
            cancel.addEventListener("click", function () { finish(false); });
            send.addEventListener("click", function () { finish(true); });
            overlay.addEventListener("click", function (event) { if (event.target === overlay) finish(false); });
            actions.appendChild(cancel); actions.appendChild(send);
            card.appendChild(title); card.appendChild(text); card.appendChild(meta); card.appendChild(actions);
            overlay.appendChild(card); document.body.appendChild(overlay); send.focus();
        });
    }

    async function sendEmail() {
        if (state.sending || state.sent || state.recipientCount < 1) return;

        var senderEmail = String(elements.senderSelect.value || "").trim();
        var replyToEmail = String(elements.replyToSelect.value || "").trim();
        var senderSource = selectedSource(elements.senderSelect);
        var useTemplate = elements.sendMode.value === "template";
        var subject = String(elements.subject.value || "").trim();
        var message = String(elements.message.value || "").trim();
        var templateId = useTemplate ? String(elements.templateSelect.value || "").trim() : "";
        var confirmationLabel = "";

        if (!senderEmail) { setNotice("Select a sender email address.", "error"); return; }
        if (!replyToEmail) { setNotice("Select a Reply-To email address.", "error"); return; }

        if (!isAllowedSender(senderEmail) && (senderSource === "current_user" || senderSource === "record_owner")) {
            setNotice((senderSource === "record_owner" ? "Record Owner's Email" : "My Email") + " is available in Zoho's native Mass Email flow, but this address is not enabled for the individual Send Mail API used by this custom composer. Choose an Organization/allowed email for Sender; Reply-To can still be the current user or record owner.", "error");
            return;
        }

        if (useTemplate) {
            if (!templateId) { setNotice("Select a CRM email template.", "error"); elements.templateSelect.focus(); return; }
            var selected = elements.templateSelect.options[elements.templateSelect.selectedIndex];
            confirmationLabel = selected ? " using “" + selected.textContent + "”" : " using the selected CRM template";
        } else {
            if (!subject) { setNotice("Enter an email subject.", "error"); elements.subject.focus(); return; }
            if (!message) { setNotice("Enter an email message.", "error"); elements.message.focus(); return; }
        }

        var confirmed = await showSendConfirmation(confirmationLabel, senderEmail, replyToEmail);
        if (!confirmed) return;

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
                var failed = Array.isArray(data.failed_recipients) ? data.failed_recipients.join(", ") : "";
                setNotice("Sent " + sentCount + ". Failed " + failedCount + (failed ? ": " + failed : "."), "error");
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
        if (state.missingEmailCount > 0) summary += " · " + state.missingEmailCount + " missing email" + (state.missingEmailCount === 1 ? "" : "s");
        elements.recipientSummary.textContent = summary;
        renderRecipientList();

        elements.sendMode.disabled = state.sending || state.sent;
        elements.senderSelect.disabled = state.sending || state.sent;
        elements.replyToSelect.disabled = state.sending || state.sent;
        elements.sendButton.disabled = state.sending || state.sent || state.recipientCount < 1;
        elements.sendButton.textContent = state.sending ? "Sending…" : (state.sent ? "Email Sent" : "Send Email");
    }

    function renderRecipientList() {
        elements.recipientList.innerHTML = "";
        if (!state.recipients.length) {
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

    function showFatalError(message) { state.loading = false; render(message); }
    function errorMessage(error) {
        if (error && error.message) return String(error.message);
        if (typeof error === "string") return error;
        return "Unable to complete the request.";
    }

    function closeWidget() {
        if (window.ZOHO && ZOHO.CRM && ZOHO.CRM.UI && ZOHO.CRM.UI.Popup) ZOHO.CRM.UI.Popup.close();
        else window.close();
    }

    function initialize() {
        cacheElements();
        addEventListeners();
        render();
        if (!window.ZOHO || !ZOHO.embeddedApp) {
            showFatalError("The Zoho Widget SDK did not load. Open this widget from CRM.");
            return;
        }
        ZOHO.embeddedApp.on("PageLoad", function (pageData) { startFromPageData(pageData || {}); });
        ZOHO.embeddedApp.init();
        window.setTimeout(function () {
            if (!state.started) {
                var id = getQueryEventId();
                if (id) startWithEventId(id);
                else showFatalError("No Party Event ID was received. Open this widget from an Event record.");
            }
        }, 8000);
    }

    document.addEventListener("DOMContentLoaded", initialize);
}());
