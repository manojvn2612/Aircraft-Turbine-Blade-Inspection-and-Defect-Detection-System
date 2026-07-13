import ResultsTable from "@/components/ResultsTable";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import { useEffect } from "react";

interface LocationState {
  imgSrc: string;
  imgClasses: number[];  // ✅ FIXED TYPE
}

interface Defect {
  defectName: string;
  occurrence: number;
}

const ResultsPage = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const state = location.state as LocationState | null;

  // ✅ CRITICAL SAFETY CHECK
  if (!state || !state.imgSrc || !state.imgClasses) {
    return <Navigate to="/" replace />;
  }

  const imgSrc = state.imgSrc;
  const imgClasses = state.imgClasses;

  const uniqs = imgClasses.reduce<Record<string, number>>((acc, val) => {
    const key = String(val);
    acc[key] = acc[key] === undefined ? 1 : acc[key] + 1;
    return acc;
  }, {});

  const imgDefects: Defect[] = Object.keys(uniqs).map(key => ({
    defectName: key,
    occurrence: uniqs[key],
  }));

  const goBack = () => {
    navigate(-1);
  };

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "auto";
    };
  }, []);

  return (
    <div className="w-full h-screen flex flex-col p-4 gap-4 bg-white overflow-hidden">
      <Button
        variant="ghost"
        className="w-fit flex gap-2 text-base font-semibold hover:bg-primary hover:text-white"
        onClick={goBack}
      >
        <ChevronLeft className="w-4 h-4" />
        Back
      </Button>

      <div className="w-full flex flex-1 overflow-hidden">
        <ResultsTable imgSrc={imgSrc} defects={imgDefects} />
      </div>
    </div>
  );
};

export default ResultsPage;