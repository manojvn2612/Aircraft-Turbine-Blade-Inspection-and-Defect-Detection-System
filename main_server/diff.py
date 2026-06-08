import os
import zipfile
import shutil

# ===============================
# CONFIGURATION
# ===============================
ZIP_FILE = r"D:\Downloads\annote.zip"
OUTPUT_FOLDER = "filtered_data"  # Output folder

# Supported image and label extensions
IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".bmp"]
LABEL_EXTENSIONS = [".txt", ".xml", ".json"]

# ===============================
# STEP 1: EXTRACT ZIP
# ===============================
TEMP_EXTRACT = "temp_extract"

if os.path.exists(TEMP_EXTRACT):
    shutil.rmtree(TEMP_EXTRACT)

os.makedirs(TEMP_EXTRACT, exist_ok=True)

with zipfile.ZipFile(ZIP_FILE, 'r') as zip_ref:
    zip_ref.extractall(TEMP_EXTRACT)

print(f"ZIP extracted to: {TEMP_EXTRACT}")

# ===============================
# STEP 2: CREATE OUTPUT FOLDERS
# ===============================
images_output = os.path.join(OUTPUT_FOLDER, "images")
labels_output = os.path.join(OUTPUT_FOLDER, "labels")

os.makedirs(images_output, exist_ok=True)
os.makedirs(labels_output, exist_ok=True)

# ===============================
# STEP 3: COLLECT FILES
# ===============================
image_files = {}
label_files = {}

for root, dirs, files in os.walk(TEMP_EXTRACT):
    for file in files:
        file_path = os.path.join(root, file)

        filename, ext = os.path.splitext(file)
        ext = ext.lower()

        # Store image files
        if ext in IMAGE_EXTENSIONS:
            image_files[filename] = file_path

        # Store label files
        elif ext in LABEL_EXTENSIONS:
            label_files[filename] = file_path

# ===============================
# STEP 4: FIND MATCHING FILES
# ===============================
matching_names = set(image_files.keys()) & set(label_files.keys())

print(f"Total Images Found : {len(image_files)}")
print(f"Total Labels Found : {len(label_files)}")
print(f"Matching Pairs     : {len(matching_names)}")

# ===============================
# STEP 5: COPY ONLY MATCHING FILES
# ===============================
for name in matching_names:

    # Copy image
    image_src = image_files[name]
    image_dst = os.path.join(images_output, os.path.basename(image_src))
    shutil.copy2(image_src, image_dst)

    # Copy label
    label_src = label_files[name]
    label_dst = os.path.join(labels_output, os.path.basename(label_src))
    shutil.copy2(label_src, label_dst)

print("\nOnly matching image-label pairs were kept.")
print(f"Filtered dataset saved in: {OUTPUT_FOLDER}")

# ===============================
# OPTIONAL: CREATE CLEAN ZIP
# ===============================
clean_zip_name = "filtered_dataset.zip"

with zipfile.ZipFile(clean_zip_name, 'w', zipfile.ZIP_DEFLATED) as zipf:
    for root, dirs, files in os.walk(OUTPUT_FOLDER):
        for file in files:
            file_path = os.path.join(root, file)
            arcname = os.path.relpath(file_path, OUTPUT_FOLDER)
            zipf.write(file_path, arcname)

print(f"Clean ZIP created: {clean_zip_name}")