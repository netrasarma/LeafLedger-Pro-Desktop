#!/usr/bin/env python3
"""
scripts/generate_cert.py
Generates a standard two-tier Certificate Chain (Root CA -> Code Signing Leaf)
tailored for Leaf Ledger Pro to satisfy Windows SmartScreen and Authenticode validation.
"""

import os
import sys
import datetime

# Force UTF-8 output on Windows (avoids cp1252 errors)
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

try:
    from cryptography import x509
    from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives.serialization import pkcs12
except ImportError:
    print("Error: The 'cryptography' package is not installed.")
    print("Please install it using: pip install cryptography")
    sys.exit(1)

def generate_code_signing_cert(output_dir=None, password="leafledger2026"):
    if output_dir is None:
        output_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    now = datetime.datetime.now(datetime.timezone.utc)
    one_day_buffer = datetime.timedelta(days=1)
    ten_years = datetime.timedelta(days=365 * 10)

    # ==========================================
    # STEP 1: Generate Root CA
    # ==========================================
    print("[ROOT] Generating Root CA Private Key (RSA 2048-bit)...")
    root_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048
    )

    root_name = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "Leaf Ledger Pro Root CA"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Leaf Ledger Pro"),
        x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "Root Authority"),
        x509.NameAttribute(NameOID.COUNTRY_NAME, "IN"),
    ])

    print("[ROOT] Building Root CA Certificate (ca=True)...")
    root_cert = (
        x509.CertificateBuilder()
        .subject_name(root_name)
        .issuer_name(root_name)
        .public_key(root_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - one_day_buffer)
        .not_valid_after(now + ten_years)
        .add_extension(
            x509.BasicConstraints(ca=True, path_length=None), 
            critical=True
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,  # Allowed to sign certificates
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True
        )
        .sign(root_key, hashes.SHA256())
    )

    # ==========================================
    # STEP 2: Generate Code Signing Leaf
    # ==========================================
    print("[LEAF] Generating Code Signing Leaf Private Key (RSA 2048-bit)...")
    leaf_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048
    )

    leaf_name = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "Leaf Ledger Pro Desktop"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Leaf Ledger Pro Desktop"),
        x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "Code Signing Division"),
        x509.NameAttribute(NameOID.COUNTRY_NAME, "IN"),
    ])

    print("[LEAF] Building Code Signing Leaf Certificate (ca=False, signed by Root CA)...")
    leaf_cert = (
        x509.CertificateBuilder()
        .subject_name(leaf_name)
        .issuer_name(root_name)  # Issuer is the Root CA
        .public_key(leaf_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - one_day_buffer)
        .not_valid_after(now + ten_years)
        .add_extension(
            x509.BasicConstraints(ca=False, path_length=None), 
            critical=True
        )
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CODE_SIGNING]),
            critical=True
        )
        .sign(root_key, hashes.SHA256())  # Signed with Root CA key
    )

    pfx_path = os.path.join(output_dir, "leaf_ledger_codesign.pfx")
    cer_path = os.path.join(output_dir, "leaf_ledger_root_ca.cer")

    # ==========================================
    # STEP 3: Bundle into PFX
    # ==========================================
    print("[EXPORT] Exporting Certificate & Private Key to PFX archive...")
    pfx_data = pkcs12.serialize_key_and_certificates(
        name=b"Leaf Ledger Pro Desktop Code Signing",
        key=leaf_key,
        cert=leaf_cert,
        cas=[root_cert],  # Bundle the Root CA as the chain
        encryption_algorithm=serialization.BestAvailableEncryption(password.encode("utf-8"))
    )

    with open(pfx_path, "wb") as f:
        f.write(pfx_data)

    # Serialize Root CA certificate to DER format (.cer)
    print("[EXPORT] Exporting Root CA Certificate to DER (.cer)...")
    with open(cer_path, "wb") as f:
        f.write(root_cert.public_bytes(serialization.Encoding.DER))

    print("========================================================")
    print("[DONE] Certificate Generation Complete!")
    print(f"PFX Code Signing File: {os.path.abspath(pfx_path)}")
    print(f"Root CA Public Cert:   {os.path.abspath(cer_path)}")
    print("========================================================")

if __name__ == "__main__":
    generate_code_signing_cert()
