from alembic import context
from sqlalchemy import create_engine, pool

from collaboration.config import DatabaseSettings
from collaboration.database import Base
from collaboration import models  # noqa: F401
from collaboration.teams import models as team_models  # noqa: F401
from collaboration import invitations  # noqa: F401
from collaboration import openings  # noqa: F401
from collaboration import profiles  # noqa: F401
from collaboration import team_profiles  # noqa: F401
from collaboration import legacy_import  # noqa: F401
from collaboration import device_auth  # noqa: F401

settings = DatabaseSettings()

if context.is_offline_mode():
    context.configure(url=settings.database_url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
elif context.config.attributes.get("connection") is not None:
    context.configure(connection=context.config.attributes["connection"], target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(settings.database_url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()
