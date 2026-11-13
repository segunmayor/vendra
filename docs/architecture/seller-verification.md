# Seller registration and verification

At launch, businesses can apply to sell and staff verify them. Approved sellers cannot list products yet: marketplace selling opens after launch, on the same `Seller` record.

## Flow

```
draft ──send──▶ pending_verification ──approve──▶ active
  ▲                     │ └─────────reject────▶ rejected
  └─ changes_requested ◀┘ ask for changes
```

1. The applicant creates a seller account on the seller portal and saves their business details: shop name, registered name, CAC number (RC for a company, BN for a business name), optional TIN, a Nigerian mobile number and the business address.
2. They attach documents: PDF, JPEG, PNG or WebP. Which kinds are required is set in Admin, Settings, Seller applications.
3. They send it for review. Details and documents are locked from then on.
4. Staff with `vendors.approve` open Admin, Sellers, check the details against the CAC public search and the documents, then approve, reject, or ask for changes. Rejecting or asking for changes needs a message, which the applicant reads on the seller portal.
5. After "ask for changes", the applicant edits and sends it again. Rejection is final for that account.

Each sending creates a verification case holding a snapshot of the details and the documents sent with it, so staff always see exactly what was reviewed, including earlier submissions. Removing a document only hides it from the current application; it stays available on the submission it belonged to.

## Rules

- One application per seller account (partial unique index on `sellers.ownerAccount`).
- The CAC number is not unique: someone could type another business's number to block it. Instead, staff see a warning listing every other application with the same number.
- A decision carries the version the reviewer was looking at. If the applicant changed the application since, the decision is refused with "reload".
- Turning off "Accept new seller applications" stops new applications. Applicants who have already started can finish theirs.
- Every save, upload, removal, submission and decision is in the audit log (`sellers.*`). Submissions and decisions also record `SellerApplicationSubmitted`, `SellerApproved`, `SellerRejected` and `SellerChangesRequested` events for notifications to pick up once a provider is chosen.

## Documents

- The type is judged by the file's first bytes, not its name or the type the browser claimed. The stored name always ends in the real extension.
- Size limit: the "Largest document file" setting (default 5 MB), and never more than 10 MB. Larger requests are refused before they are read in full (HTTP 413).
- Up to 3 files of each kind and 12 in total per application.
- Files are stored in PostgreSQL (`sellers.seller_documents`, with a SHA-256 of each) because volumes are small at launch and no file store has been chosen. Moving them to object storage changes only the repository.
- Files are only ever sent as downloads (`Content-Disposition: attachment`, `nosniff`, a sandboxing CSP), through the portal's own route, so an uploaded file can never run as a page. Applicants can open only their own files; staff need `vendors.approve`.

## Settings (Admin, Settings, Seller applications)

| Setting | Default |
| --- | --- |
| Accept new seller applications | On |
| Require the CAC registration certificate | On |
| Require the owner or director's ID | On |
| Require proof of business address | On |
| Require the TIN certificate | Off |
| Largest document file | 5 MB (1 to 10) |
| Message to approved sellers | "Your business is verified. Selling opens soon…" |

## API

| Endpoint | Who |
| --- | --- |
| `GET /v1/vendor/application` | Applicant: their application and what it needs |
| `PUT /v1/vendor/application` | Applicant: start, or change details |
| `POST /v1/vendor/application/documents` (multipart: `kind`, `file`) | Applicant |
| `DELETE /v1/vendor/application/documents/{id}` | Applicant |
| `GET /v1/vendor/application/documents/{id}` | Applicant: download their own file |
| `POST /v1/vendor/application/submit` | Applicant |
| `GET /v1/admin/sellers?status=` and `/counts` | `vendors.approve` |
| `GET /v1/admin/sellers/{id}` | `vendors.approve`: details, every submission, same-CAC warning |
| `GET /v1/admin/sellers/{id}/documents/{documentId}` | `vendors.approve` |
| `POST /v1/admin/sellers/{id}/review` | `vendors.approve`: `approve`, `reject` or `request_changes` |
