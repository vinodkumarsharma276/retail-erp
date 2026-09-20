import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { DistributorForm } from '../../components/DistributorForm';

export function DistributorFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  return (
    <div className="mx-auto max-w-[1600px] pb-24 lg:pb-0">
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={() => navigate(-1)}
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-semibold sm:text-2xl">
          {isEditMode ? 'Edit Distributor' : 'Add Distributor'}
        </h1>
      </div>

      <DistributorForm
        distributorId={id}
        onSuccess={() => navigate('/distributors', { replace: true })}
        onCancel={() => navigate(-1)}
      />
    </div>
  );
}
