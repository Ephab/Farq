"""Central identities, deliberately independent of personal students."""
from alembic import op
import sqlalchemy as sa

revision = "0001_accounts"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("accounts",
                    sa.Column("id", sa.String(36), primary_key=True),
                    sa.Column("issuer", sa.String(512), nullable=False),
                    sa.Column("subject", sa.String(255), nullable=False),
                    sa.Column("display_name", sa.String(120), nullable=False),
                    sa.Column("disabled", sa.Boolean(), nullable=False),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
                    sa.UniqueConstraint("issuer", "subject", name="uq_account_identity"))


def downgrade():
    op.drop_table("accounts")
