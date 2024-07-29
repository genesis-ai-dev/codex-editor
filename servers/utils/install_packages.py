"""
Installs needed dependencies automatically
"""
import sys
import os
import subprocess


def install_dependencies() -> bool:
    """Install required dependencies from requirements.txt."""
    script_directory = os.path.dirname(os.path.abspath(__file__))
    requirements_file = os.path.join(script_directory, "requirements.txt")
    try:
        subprocess.check_call([sys.executable, "-m", "pip3.11", "install", "--break-system-packages", "-q", "-r", requirements_file])
    except subprocess.CalledProcessError as e:
        print(f"Failed to install with system package breaking: {e}")
        try:
            # If the previous command fails, try without the --break-system-packages option
            subprocess.check_call([sys.executable, "-m", "pip3.11", "install", "-q", "-r", requirements_file])
        except subprocess.CalledProcessError as ee:
            print(f"Failed to install without breaking system packages: {ee}")
            return False
    return True

INSTALLED = install_dependencies()
