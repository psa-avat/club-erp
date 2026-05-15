import boto3
from botocore.client import Config
import os



# --- CONFIGURATION ---
# Replace with your actual rustfs details
ENDPOINT = "http://localhost:9000" 
ACCESS_KEY = os.getenv("RUSTFS_ACCESS_KEY", "")
SECRET_KEY = os.getenv("RUSTFS_SECRET_KEY", "")
BUCKET_NAME = os.getenv("RUSTFS_BUCKET_NAME","")

print(f"Using Rustfs Endpoint: {ENDPOINT}")
print(f"Using Access Key: {ACCESS_KEY}")
print(f"Using Bucket Name: {BUCKET_NAME}")    


# Initialize the S3 client for Rustfs
s3 = boto3.client(
    's3',
    endpoint_url=ENDPOINT,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    config=Config(signature_version='s3v4'),
    region_name='us-east-1' # Rustfs doesn't strictly care, but Boto3 needs a value
)

def upload_member_file(member_id, local_file, category="profile"):
    """Stores a file in the specific member folder structure."""
    filename = local_file.split('/')[-1]
    # Path: members/ME2024-0042/profile/photo.jpg
    s3_key = f"members/{member_id}/{category}/{filename}"
    
    s3.upload_file(local_file, BUCKET_NAME, s3_key)
    print(f"✅ Uploaded {filename} to {s3_key}")

def list_all_files():
    """Lists every file in the bucket."""
    print(f"\n--- Files in {BUCKET_NAME} ---")
    response = s3.list_objects_v2(Bucket=BUCKET_NAME)
    
    if 'Contents' in response:
        for obj in response['Contents']:
            # Key is the path, Size is in bytes
            print(f"📄 {obj['Key']} ({obj['Size']} bytes)")
    else:
        print("Bucket is empty.")

# --- EXECUTION ---
if __name__ == "__main__":
    # 1. Store a test file
    # Ensure 'test_photo.jpg' exists in your current folder
    try:
        upload_member_file("ME2026-0001", "README.md", "profile")
    except Exception as e:
        print(f"❌ Upload failed: {e}")

    # 2. List results
    list_all_files()