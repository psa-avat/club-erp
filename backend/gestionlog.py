"""    
    ERP-CLUB - ERP pour Club de vol à voile 
    - Logiciel libre de gestion d'un club de vol à voile
    - Backend API principale
    Copyright (C) 2026  SAFORCADA Patrick

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 """
import loguru
import logging
import sys


class InterceptHandler(logging.Handler):
    """
    Intercept standard logging messages and redirect them to loguru.
    This ensures all logging (from FastAPI, Uvicorn, SQLAlchemy, etc.) goes through loguru.
    """

    def emit(self, record):
        # Get corresponding Loguru level if it exists
        try:
            level = loguru.logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        # Find caller from where originated the logged message
        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_name == 'emit':
            frame = frame.f_back
            depth += 1

        loguru.logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


class GestionLog:
    """Log management configuration for CarnetDeVol"""

    def __init__(self):
        self._log_handler_ids = []

    def setup_logging(self):
        """
        Configure logging to intercept all standard logging and forward to loguru.
        Outputs to stderr with colored formatting optimized for Dozzle.
        """
        
        # Intercept Uvicorn, FastAPI, and SQLAlchemy loggers
        logging.root.handlers = [InterceptHandler()]
        logging.root.setLevel(logging.INFO)

        # Forward all existing loggers to the InterceptHandler
        for name in logging.root.manager.loggerDict.keys():
            logging.getLogger(name).handlers = []
            logging.getLogger(name).propagate = True

        # Configure Loguru (this is where log rotation would happen if needed)
        loguru.logger.remove()  # Remove default handler
        
        # Add stderr output optimized for Docker/Dozzle
        loguru.logger.add(
            sys.stderr,  # Preferred for containerized logs
            format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
            colorize=True,  # Force color even if Docker tries to mask it
            level="DEBUG"  # Default level for console
        )


# Singleton instance
LogConfig = GestionLog()
