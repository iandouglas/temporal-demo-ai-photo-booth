"""Temporal definitions registered by the worker."""

from .activities import analyze_photo, compose_strip, make_animated_strip, render_placeholder, render_scene
from .workflows import PhotoBoothWorkflow

WORKFLOWS: list = [PhotoBoothWorkflow]
ACTIVITIES: list = [analyze_photo, render_scene, render_placeholder, compose_strip, make_animated_strip]
