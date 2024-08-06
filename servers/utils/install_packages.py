import sys
import os
import subprocess
from typing import Optional
from importlib import util

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

def check_requirements_met() -> bool:
    """Check if required packages are installed by reading requirements.txt."""
    try:
        script_directory = os.path.dirname(os.path.abspath(__file__))
        requirements_file = os.path.join(script_directory, "requirements.txt")
        with open(requirements_file, "r") as f:
            required_packages = [line.strip() for line in f.readlines()]
        for package in required_packages:
            spec = util.find_spec(package)
            if spec is None:
                return False
        return True
    except:
        return False

if not check_requirements_met():
    INSTALLED = install_dependencies()
else:
    INSTALLED = True
