"""Team-scoped editable assignment brief."""
from alembic import op
import sqlalchemy as sa
revision = "0011_project_details"
down_revision = "0010_device_auth"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("teams", sa.Column("assignment_override_json", sa.Text(), nullable=False, server_default="{}"))

def downgrade():
    op.drop_column("teams", "assignment_override_json")
