# Tantzers Event Registration Widget

Zoho CRM button widget for adding and removing Families, Patients/Siblings, and Volunteers from Party Events.

## Files

- `index.html` - widget markup.
- `widget.css` - responsive Zoho-style presentation.
- `widget.js` - Zoho Widget SDK integration, search, selection, registration creation, and registration removal.
- `get_event_registration_options.deluge` - CRM function source used by API name `get_event_registration_options_1`.

## Deployment

GitHub Pages publishes the repository's `main` branch from `/(root)`. The live widget URL is:

`https://swebsoftware.github.io/tantzers_event_registration/`

Zoho CRM registers that URL as an externally hosted Button widget.

## Removal behavior

The Deluge function returns the matching `Event_Registrations` record ID as `registrationId`. Registered rows display a **Remove** button. After confirmation, the widget deletes only that Event Registration record; it never deletes the source Family, Patient/Sibling, Volunteer, or Party Event.

After updating the function in Zoho CRM, reload the CRM detail page before testing the Remove button.
